import type { Env } from "#api/env";
import { fetchTransactionOutspends } from "#api/integrations/electrs";

interface RecoveryOutputIdentity {
  txid: string;
  vout: number;
  classification: string;
}

type FetchOutspends = typeof fetchTransactionOutspends;
const ELECTRS_BATCH_SIZE = 10;
const ELECTRS_BATCH_INTERVAL_MS = 2_000;

export function verificationRetryDelay(attempts: number): number {
  return Math.min(6 * 60 * 60, 30 * 2 ** Math.min(10, Math.max(0, attempts - 1)));
}

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

export async function verifyRecoveryTransactions(
  env: Env,
  transactionLimit = 25,
  options: { fetchOutspends?: FetchOutspends; now?: number; batchIntervalMs?: number } = {},
): Promise<{ transactions: number; outputs: number; spent: number; failed: number }> {
  const limit = Math.min(100, Math.max(1, Math.trunc(transactionLimit)));
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const fetchOutspends = options.fetchOutspends ?? fetchTransactionOutspends;
  const batchIntervalMs = options.batchIntervalMs ?? ELECTRS_BATCH_INTERVAL_MS;
  const transactionRows = await env.RECOVERY_DB.prepare(
    `SELECT o.txid FROM recovery_outputs o
      LEFT JOIN recovery_verification_failures f ON f.txid=o.txid
      WHERE o.chain_checked_at IS NULL AND (f.next_retry_at IS NULL OR f.next_retry_at<=?)
      GROUP BY o.txid ORDER BY COALESCE(f.next_retry_at,0),o.txid LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ txid: string }>();
  if (transactionRows.results.length === 0) return { transactions: 0, outputs: 0, spent: 0, failed: 0 };

  const identities = (
    await env.RECOVERY_DB.batch(
      transactionRows.results.map((row) =>
        env.RECOVERY_DB.prepare(`SELECT txid,vout,classification FROM recovery_outputs WHERE txid=?`).bind(row.txid),
      ),
    )
  ).flatMap((result) => result.results as unknown as RecoveryOutputIdentity[]);
  const outspendsByTxid = new Map<string, Awaited<ReturnType<typeof fetchTransactionOutspends>>>();
  const failures = new Map<string, string>();
  for (let offset = 0; offset < transactionRows.results.length; offset += ELECTRS_BATCH_SIZE) {
    const batch = transactionRows.results.slice(offset, offset + ELECTRS_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((row) => fetchOutspends(env.ELECTRS_API_BASE, row.txid)));
    batch.forEach((row, index) => {
      const result = results[index];
      if (result.status === "fulfilled") outspendsByTxid.set(row.txid, result.value);
      else failures.set(row.txid, result.reason instanceof Error ? result.reason.message : "Electrs lookup failed");
    });
    if (offset + ELECTRS_BATCH_SIZE < transactionRows.results.length && batchIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, batchIntervalMs));
    }
  }

  let spent = 0;
  const update = env.RECOVERY_DB.prepare(
    `UPDATE recovery_outputs SET classification=?,reason=?,spent_by_txid=?,spent_height=?,chain_checked_at=?
      WHERE txid=? AND vout=?`,
  );
  const successfulTxids = new Set(transactionRows.results.map((row) => row.txid).filter((txid) => !failures.has(txid)));
  for (const identity of identities) {
    if (!successfulTxids.has(identity.txid)) continue;
    const result = outspendsByTxid.get(identity.txid)?.[identity.vout];
    if (!result) {
      successfulTxids.delete(identity.txid);
      failures.set(identity.txid, `Electrs omitted output ${identity.vout}`);
    }
  }
  const updates = identities
    .filter((identity) => successfulTxids.has(identity.txid))
    .map((identity) => {
      const result = outspendsByTxid.get(identity.txid)![identity.vout];
      if (result.spent) spent++;
      const sourceVerified = identity.classification === "recoverable" || identity.classification === "spent";
      return update.bind(
        sourceVerified ? (result.spent ? "spent" : "recoverable") : identity.classification,
        sourceVerified
          ? result.spent
            ? "verified-output-already-spent"
            : "verified-counterparty-recovery-output"
          : "counterparty-provenance-not-verified",
        result.spent ? result.txid : null,
        result.spent ? result.block_height : null,
        now,
        identity.txid,
        identity.vout,
      );
    });
  for (const batch of chunks(updates, 100)) await env.RECOVERY_DB.batch(batch);
  const bookkeeping = [
    ...[...successfulTxids].map((txid) =>
      env.RECOVERY_DB.prepare(`DELETE FROM recovery_verification_failures WHERE txid=?`).bind(txid),
    ),
    ...[...failures].map(([txid, message]) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_verification_failures
           (txid,attempts,first_failed_at,last_failed_at,next_retry_at,last_error)
         VALUES (?,1,?,?,?,?)
         ON CONFLICT(txid) DO UPDATE SET
           attempts=attempts+1,last_failed_at=excluded.last_failed_at,
           next_retry_at=excluded.last_failed_at + MIN(21600,30 * (1 << MIN(10,attempts))),
           last_error=excluded.last_error`,
      ).bind(txid, now, now, now + verificationRetryDelay(1), message.slice(0, 500)),
    ),
  ];
  for (const batch of chunks(bookkeeping, 100)) await env.RECOVERY_DB.batch(batch);
  return {
    transactions: successfulTxids.size,
    outputs: updates.length,
    spent,
    failed: failures.size,
  };
}
