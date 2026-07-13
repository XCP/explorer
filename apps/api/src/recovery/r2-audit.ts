import type { Env } from "#api/env";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";

export interface RecoveryR2AuditPage {
  checked: number;
  missing: string[];
  corrupt: Array<{ txid: string; reason: string }>;
  next_cursor: string | null;
}

const txidPattern = /^[0-9a-f]{64}$/;

export async function auditRecoveryTransactionObjects(
  bucket: R2Bucket,
  txids: string[],
): Promise<Omit<RecoveryR2AuditPage, "next_cursor">> {
  const missing: string[] = [];
  const corrupt: Array<{ txid: string; reason: string }> = [];

  await Promise.all(
    txids.map(async (txid) => {
      const object = await bucket.get(`transactions/${txid}.hex`);
      if (!object) {
        missing.push(txid);
        return;
      }
      try {
        const rawTransactionHex = (await object.text()).trim();
        const parsed = parseRecoveryTransaction(rawTransactionHex);
        if (parsed.txid !== txid) corrupt.push({ txid, reason: `body hashes to ${parsed.txid}` });
      } catch (error) {
        corrupt.push({ txid, reason: error instanceof Error ? error.message : "invalid transaction body" });
      }
    }),
  );

  missing.sort();
  corrupt.sort((left, right) => left.txid.localeCompare(right.txid));
  return { checked: txids.length, missing, corrupt };
}

export async function auditRecoveryR2Page(
  env: Pick<Env, "RECOVERY_DB" | "RECOVERY_TRANSACTIONS">,
  cursor: string,
  limit: number,
): Promise<RecoveryR2AuditPage> {
  if (cursor && !txidPattern.test(cursor)) throw new Error("invalid recovery R2 audit cursor");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid recovery R2 audit limit");

  const rows = await env.RECOVERY_DB.prepare(
    `SELECT txid FROM recovery_outputs WHERE txid>? GROUP BY txid ORDER BY txid LIMIT ?`,
  )
    .bind(cursor, limit)
    .all<{ txid: string }>();
  const txids = rows.results.map(({ txid }) => txid);
  const result = await auditRecoveryTransactionObjects(env.RECOVERY_TRANSACTIONS, txids);
  return {
    ...result,
    next_cursor: txids.length === limit ? txids.at(-1)! : null,
  };
}
