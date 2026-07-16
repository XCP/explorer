import type { Env } from "#api/env";
import {
  RECOVERY_CLASSIFIER_VERSION,
  classifyRecovery,
  p2pkhAddress,
  parseBareMultisig,
  verifyCounterpartyLayout,
} from "#api/recovery/classifier";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";

export interface RecoveryImportOutput {
  vout: number;
  value_sats: number;
  script_pubkey_hex: string;
  block_height?: number | null;
  block_time?: number | null;
  spent_by_txid?: string | null;
  spent_height?: number | null;
}

export interface RecoveryImportTransaction {
  txid: string;
  raw_transaction_hex: string;
  outputs: RecoveryImportOutput[];
}

const hashPattern = /^[0-9a-f]{64}$/i;

export async function batchRecoveryStatements(
  db: Pick<D1Database, "batch">,
  statements: D1PreparedStatement[],
): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += 100)
    await db.batch(statements.slice(offset, offset + 100));
}

export async function importRecoveryTransactions(env: Env, rows: RecoveryImportTransaction[]): Promise<number> {
  if (rows.length === 0 || rows.length > 100) throw new Error("expected 1 to 100 transactions");
  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  const blobs: Promise<unknown>[] = [];
  const upsert = env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_outputs
       (txid,vout,value_sats,script_pubkey_hex,layout,recovery_key_hex,recovery_key_position,recovery_address,
        classification,reason,block_height,block_time,spent_by_txid,spent_height,verified_at,classifier_version,chain_checked_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(txid,vout) DO UPDATE SET
       value_sats=excluded.value_sats,script_pubkey_hex=excluded.script_pubkey_hex,layout=excluded.layout,
       recovery_key_hex=excluded.recovery_key_hex,recovery_key_position=excluded.recovery_key_position,
       recovery_address=excluded.recovery_address,classification=excluded.classification,reason=excluded.reason,
       block_height=excluded.block_height,block_time=excluded.block_time,spent_by_txid=excluded.spent_by_txid,
       spent_height=excluded.spent_height,verified_at=excluded.verified_at,classifier_version=excluded.classifier_version,
       chain_checked_at=NULL`,
  );

  for (const row of rows) {
    const expectedTxid = row.txid.toLowerCase();
    if (!hashPattern.test(expectedTxid)) throw new Error("invalid transaction hash");
    const transaction = parseRecoveryTransaction(row.raw_transaction_hex);
    if (transaction.txid !== expectedTxid) throw new Error(`raw transaction hash mismatch: ${expectedTxid}`);
    if (!Array.isArray(row.outputs) || row.outputs.length === 0)
      throw new Error(`transaction has no outputs: ${expectedTxid}`);
    blobs.push(
      env.RECOVERY_TRANSACTIONS.put(`transactions/${expectedTxid}.hex`, row.raw_transaction_hex.toLowerCase(), {
        httpMetadata: { contentType: "text/plain" },
        customMetadata: { txid: expectedTxid },
      }),
    );

    for (const candidate of row.outputs) {
      if (!Number.isSafeInteger(candidate.vout) || candidate.vout < 0) throw new Error("invalid output index");
      if (!Number.isSafeInteger(candidate.value_sats) || candidate.value_sats < 0)
        throw new Error("invalid output value");
      const output = transaction.output(candidate.vout);
      if (!output) throw new Error(`output does not exist: ${expectedTxid}:${candidate.vout}`);
      if (output.valueSats !== BigInt(candidate.value_sats))
        throw new Error(`output value mismatch: ${expectedTxid}:${candidate.vout}`);
      const scriptPubkeyHex = candidate.script_pubkey_hex.toLowerCase();
      if (output.scriptPubkeyHex !== scriptPubkeyHex)
        throw new Error(`output script mismatch: ${expectedTxid}:${candidate.vout}`);

      const parsed = parseBareMultisig(scriptPubkeyHex);
      if (!parsed || parsed.requiredSignatures !== 1 || (parsed.publicKeyCount !== 2 && parsed.publicKeyCount !== 3))
        throw new Error(`unsupported recovery candidate: ${expectedTxid}:${candidate.vout}`);
      const structuralLayout = parsed.publicKeyCount === 2 ? "historical-1-of-2" : "current-1-of-3";
      const verifiedLayout = verifyCounterpartyLayout(parsed, transaction.firstInputTxid);
      const recoveryKeyPosition = verifiedLayout ? (verifiedLayout === "historical-1-of-2" ? 0 : 2) : null;
      const recoveryKeyHex = recoveryKeyPosition == null ? null : parsed.keyDataHex[recoveryKeyPosition];
      const recoveryAddress = recoveryKeyHex ? p2pkhAddress(recoveryKeyHex) : null;
      const decision = recoveryAddress
        ? classifyRecovery({
            scriptPubkeyHex,
            firstInputTxid: transaction.firstInputTxid,
            expectedAddress: recoveryAddress,
            spent: !!candidate.spent_by_txid,
          })
        : { classification: "unverified" as const, reason: "counterparty-provenance-not-verified" };

      statements.push(
        upsert.bind(
          expectedTxid,
          candidate.vout,
          candidate.value_sats,
          scriptPubkeyHex,
          structuralLayout,
          recoveryKeyHex,
          recoveryKeyPosition,
          recoveryAddress,
          decision.classification,
          decision.reason,
          candidate.block_height ?? null,
          candidate.block_time ?? null,
          candidate.spent_by_txid?.toLowerCase() ?? null,
          candidate.spent_height ?? null,
          now,
          RECOVERY_CLASSIFIER_VERSION,
        ),
      );
    }
  }
  await Promise.all(blobs);
  // A single Counterparty data transaction can legitimately contain more than D1's 100-statement batch
  // ceiling. Chunk the convergent upserts; callers advance their durable transaction cursor only after this
  // function returns, so a later chunk failure safely replays the earlier chunks on retry.
  await batchRecoveryStatements(env.RECOVERY_DB, statements);
  return statements.length;
}
