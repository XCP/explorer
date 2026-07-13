import type { Env } from "#api/env";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";

export interface RecoveryR2AuditPage {
  checked: number;
  missing: string[];
  corrupt: Array<{ txid: string; reason: string }>;
  last_cursor: string | null;
  next_cursor: string | null;
}

export interface RecoveryR2AuditManifest {
  transactions: number;
  first_txid: string | null;
  last_txid: string | null;
  total_imports: number;
  completed_imports: number;
  imports_complete: boolean;
  generation: number;
}

const txidPattern = /^[0-9a-f]{64}$/;

export async function auditRecoveryTransactionObjects(
  bucket: R2Bucket,
  txids: string[],
): Promise<Omit<RecoveryR2AuditPage, "last_cursor" | "next_cursor">> {
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
    last_cursor: txids.at(-1) ?? null,
    next_cursor: txids.length === limit ? txids.at(-1)! : null,
  };
}

export async function recoveryR2AuditManifest(db: D1Database): Promise<RecoveryR2AuditManifest> {
  const [transactions, imports, generation] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) transactions,MIN(txid) first_txid,MAX(txid) last_txid
           FROM (SELECT txid FROM recovery_outputs GROUP BY txid)`,
      )
      .first<{ transactions: number; first_txid: string | null; last_txid: string | null }>(),
    db
      .prepare(
        `SELECT COUNT(*) total_imports,
                SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) completed_imports
           FROM recovery_imports`,
      )
      .first<{ total_imports: number; completed_imports: number | null }>(),
    db.prepare(`SELECT value FROM recovery_state WHERE key='r2_audit_generation'`).first<{ value: string }>(),
  ]);
  const totalImports = Number(imports?.total_imports ?? 0);
  const completedImports = Number(imports?.completed_imports ?? 0);
  return {
    transactions: Number(transactions?.transactions ?? 0),
    first_txid: transactions?.first_txid ?? null,
    last_txid: transactions?.last_txid ?? null,
    total_imports: totalImports,
    completed_imports: completedImports,
    imports_complete: totalImports > 0 && completedImports === totalImports,
    generation: Number(generation?.value ?? 0),
  };
}
