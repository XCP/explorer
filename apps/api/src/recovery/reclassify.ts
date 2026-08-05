import type { Env } from "#api/env";
import { RECOVERY_CLASSIFIER_VERSION } from "#api/recovery/classifier";
import { importRecoveryTransactions } from "#api/recovery/import";
import { recoveryCandidates } from "#api/recovery/scanner";

/**
 * Every row records the classifier that produced its verdict, but until now nothing acted on that, so
 * improving the classifier left every previously indexed output on the old verdict forever. Raw bodies
 * are already durable in R2, so re-deciding costs no chain reads at all — only the R2 read and the
 * upsert. Ordering by txid gives the sweep a deterministic, resumable path through the backlog.
 */
// The txid-ordered WITHOUT ROWID table gives the queue query its GROUP BY order for free, so the
// planner full-scans it even when the backlog is empty — which is every tick between classifier
// bumps (~813k billed rows read per tick for nothing). The probe forces the classifier-version
// index (migration 0013) for a ~one-row emptiness check; the heavy query runs only on a real backlog.
export const RECOVERY_RECLASSIFY_PROBE_SQL = `
  SELECT 1 pending FROM recovery_outputs INDEXED BY recovery_outputs_classifier
   WHERE classifier_version<? LIMIT 1`;

export const RECOVERY_RECLASSIFY_QUEUE_SQL = `
  SELECT txid,MIN(block_height) block_height,MIN(block_time) block_time
    FROM recovery_outputs WHERE classifier_version<? GROUP BY txid ORDER BY txid LIMIT ?`;

interface OutdatedTransactionRow {
  txid: string;
  block_height: number | null;
  block_time: number | null;
}

export async function reclassifyRecoveryOutputs(
  env: Env,
  transactionLimit = 25,
): Promise<{ transactions: number; outputs: number; missing: number }> {
  const limit = Math.min(100, Math.max(1, Math.trunc(transactionLimit)));
  const pending = await env.RECOVERY_DB.prepare(RECOVERY_RECLASSIFY_PROBE_SQL)
    .bind(RECOVERY_CLASSIFIER_VERSION)
    .first<{ pending: number }>();
  if (!pending) return { transactions: 0, outputs: 0, missing: 0 };
  const outdated = await env.RECOVERY_DB.prepare(RECOVERY_RECLASSIFY_QUEUE_SQL)
    .bind(RECOVERY_CLASSIFIER_VERSION, limit)
    .all<OutdatedTransactionRow>();
  if (outdated.results.length === 0) return { transactions: 0, outputs: 0, missing: 0 };

  let outputs = 0;
  let missing = 0;
  for (const row of outdated.results) {
    const object = await env.RECOVERY_TRANSACTIONS.get(`transactions/${row.txid}.hex`);
    if (!object) {
      // The R2 audit owns body coverage; skipping here keeps one absent body from stalling the sweep.
      missing++;
      continue;
    }
    const rawHex = await object.text();
    const candidates = recoveryCandidates(rawHex, row.block_height ?? 0, row.block_time);
    if (candidates.length === 0) continue;
    outputs += await importRecoveryTransactions(env, [
      { txid: row.txid, raw_transaction_hex: rawHex, outputs: candidates },
    ]);
  }
  return { transactions: outdated.results.length - missing, outputs, missing };
}
