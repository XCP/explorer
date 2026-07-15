import type { Env } from "#api/env";
import { counterpartyJson } from "#api/integrations/counterparty";
import { hashToBytes } from "#api/indexer/identities";
import { classifyStamp } from "#api/indexer/events/stamp";
import { importRecoveryTransactions, type RecoveryImportOutput } from "#api/recovery/import";
import { parseBareMultisig } from "#api/recovery/classifier";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";

const CURSOR_KEY = "recovery_scan_tx_index";

interface CoreTransaction {
  tx_index: number;
  txid: string;
  block_height: number;
  block_time: number | null;
}

interface RawTransactionEnvelope {
  result: string;
}

export function recoveryCandidates(rawHex: string, blockHeight: number, blockTime: number | null): RecoveryImportOutput[] {
  const transaction = parseRecoveryTransaction(rawHex);
  return transaction.outputs.flatMap((output, vout) => {
    const parsed = parseBareMultisig(output.scriptPubkeyHex);
    if (!parsed || parsed.requiredSignatures !== 1 || (parsed.publicKeyCount !== 2 && parsed.publicKeyCount !== 3)) {
      return [];
    }
    if (output.valueSats > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("recovery output exceeds safe integer range");
    return [{
      vout,
      value_sats: Number(output.valueSats),
      script_pubkey_hex: output.scriptPubkeyHex,
      block_height: blockHeight,
      block_time: blockTime,
    }];
  });
}

async function initializeCursor(env: Env): Promise<number> {
  const existing = await env.RECOVERY_DB.prepare(`SELECT value FROM recovery_state WHERE key=?`)
    .bind(CURSOR_KEY)
    .first<{ value: string }>();
  if (existing) return Number.parseInt(existing.value, 10);

  // Rescan the entire newest imported block. Import is an upsert, so overlap is harmless and prevents
  // a snapshot taken mid-block from leaving a permanent hole.
  const imported = await env.RECOVERY_DB.prepare(`SELECT MAX(block_height) height FROM recovery_outputs`)
    .first<{ height: number | null }>();
  const height = Number(imported?.height ?? 0);
  const beforeBlock = await env.CORE_DB.prepare(
    `SELECT COALESCE(MAX(tx_index),-1) cursor FROM transactions WHERE block_index<?`,
  )
    .bind(height)
    .first<{ cursor: number }>();
  const cursor = Number(beforeBlock?.cursor ?? -1);
  await env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_state(key,value,updated_at) VALUES (?,?,unixepoch())
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
  )
    .bind(CURSOR_KEY, String(cursor))
    .run();
  return cursor;
}

async function protectStampTransaction(env: Env, row: CoreTransaction): Promise<void> {
  const issuance = await env.CORE_DB.prepare(
    `SELECT event_index,description FROM issuances WHERE tx_hash=? AND status='valid'`,
  )
    .bind(hashToBytes(row.txid))
    .all<{ event_index: number; description: string | null }>();
  const sources = issuance.results.filter((item) => classifyStamp(item.description));
  if (sources.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  await env.RECOVERY_DB.batch([
    env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_protected_transactions(txid,protection_kind,protected_at) VALUES (?,'stamp',?)
       ON CONFLICT(txid) DO UPDATE SET protected_at=excluded.protected_at`,
    ).bind(row.txid, now),
    ...sources.map((source) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_protection_sources(txid,source,source_reference,recorded_at)
         VALUES (?,'canonical-issuance',?,?) ON CONFLICT DO NOTHING`,
      ).bind(row.txid, `issuance:${source.event_index}`, now),
    ),
  ]);
}

export async function scanRecoveryTransactions(env: Env, batchSize = 200): Promise<{ scanned: number; imported: number; cursor: number }> {
  const limit = Math.min(250, Math.max(1, Math.trunc(batchSize)));
  const cursor = await initializeCursor(env);
  const page = await env.CORE_DB.prepare(
    `SELECT tx_index,lower(hex(tx_hash)) txid,block_index block_height,block_time
       FROM transactions WHERE tx_index>? ORDER BY tx_index LIMIT ?`,
  )
    .bind(cursor, limit)
    .all<CoreTransaction>();
  if (page.results.length === 0) return { scanned: 0, imported: 0, cursor };

  const fetched: Array<{ row: CoreTransaction; rawHex: string; candidates: RecoveryImportOutput[] }> = [];
  // Five concurrent reads keep catch-up short while staying below provider and Worker subrequest limits.
  // One missing raw transaction fails the whole cursor page, so a retry cannot silently skip it.
  for (let offset = 0; offset < page.results.length; offset += 5) {
    const group = await Promise.all(
      page.results.slice(offset, offset + 5).map(async (row) => {
        const response = await counterpartyJson<RawTransactionEnvelope>(
          env.COUNTERPARTY_API_BASE,
          `/bitcoin/transactions/${row.txid}?result_format=hex`,
        );
        if (typeof response.result !== "string") throw new Error(`Counterparty omitted raw transaction ${row.txid}`);
        return {
          row,
          rawHex: response.result,
          candidates: recoveryCandidates(response.result, row.block_height, row.block_time),
        };
      }),
    );
    fetched.push(...group);
  }

  let imported = 0;
  for (const { row, rawHex, candidates } of fetched) {
    if (candidates.length > 0) {
      await protectStampTransaction(env, row);
      await importRecoveryTransactions(env, [{ txid: row.txid, raw_transaction_hex: rawHex, outputs: candidates }]);
      imported += candidates.length;
    }
  }
  const nextCursor = page.results.at(-1)!.tx_index;
  await env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_state(key,value,updated_at) VALUES (?,?,unixepoch())
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
  )
    .bind(CURSOR_KEY, String(nextCursor))
    .run();
  return { scanned: page.results.length, imported, cursor: nextCursor };
}
