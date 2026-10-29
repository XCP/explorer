import type { Env } from "#api/env";
import { mapWithLimit } from "#api/lib/net";
import { RECOVERY_CLASSIFIER_VERSION } from "#api/recovery/classifier";
import { importRecoveryTransactions, type RecoveryImportOutput } from "#api/recovery/import";
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

/**
 * Classifier v2 changes only one old verdict: an unverified historical 1-of-2 output immediately
 * after a verified historical anchor may inherit that anchor's provenance. Work those transactions
 * before the generic version sweep so the user-visible recovery improvement does not sit behind
 * hundreds of thousands of unchanged current-layout transactions.
 *
 * This is deliberately only a queue hint. The TypeScript classifier still re-parses the complete
 * raw transaction and proves the exact key and uninterrupted vout run; SQL never grants recovery.
 */
export const RECOVERY_RECLASSIFY_PRIORITY_QUEUE_SQL = `
  SELECT continuation.txid,MIN(continuation.block_height) block_height,
         MIN(continuation.block_time) block_time
    FROM recovery_outputs continuation INDEXED BY recovery_outputs_classifier
    JOIN recovery_outputs anchor
      ON anchor.txid=continuation.txid AND anchor.vout=continuation.vout-1
   WHERE continuation.classifier_version<?
     AND continuation.layout='historical-1-of-2'
     AND continuation.classification='unverified'
     AND anchor.layout='historical-1-of-2'
     AND anchor.classification IN ('recoverable','spent')
   GROUP BY continuation.txid ORDER BY continuation.txid LIMIT ?`;

const priorityStateKey = `recovery_reclassify_priority_${RECOVERY_CLASSIFIER_VERSION}_done`;

interface OutdatedTransactionRow {
  txid: string;
  block_height: number | null;
  block_time: number | null;
}

interface ExistingSpendRow {
  vout: number;
  spent_by_txid: string;
  spent_height: number | null;
}

export function retainRecoverySpendEvidence(
  candidates: RecoveryImportOutput[],
  existingSpends: ExistingSpendRow[],
): RecoveryImportOutput[] {
  const byVout = new Map(existingSpends.map((row) => [row.vout, row]));
  return candidates.map((candidate) => {
    if (candidate.spent_by_txid) return candidate;
    const existing = byVout.get(candidate.vout);
    return existing
      ? { ...candidate, spent_by_txid: existing.spent_by_txid, spent_height: existing.spent_height }
      : candidate;
  });
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

  const priorityDone = await env.RECOVERY_DB.prepare(`SELECT 1 done FROM recovery_state WHERE key=?`)
    .bind(priorityStateKey)
    .first<{ done: number }>();
  let outdated = priorityDone
    ? { results: [] as OutdatedTransactionRow[] }
    : await env.RECOVERY_DB.prepare(RECOVERY_RECLASSIFY_PRIORITY_QUEUE_SQL)
        .bind(RECOVERY_CLASSIFIER_VERSION, limit)
        .all<OutdatedTransactionRow>();
  if (!priorityDone && outdated.results.length === 0) {
    await env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_state(key,value,updated_at) VALUES (?,'1',unixepoch()) ON CONFLICT(key) DO NOTHING`,
    )
      .bind(priorityStateKey)
      .run();
  }
  if (outdated.results.length === 0) {
    outdated = await env.RECOVERY_DB.prepare(RECOVERY_RECLASSIFY_QUEUE_SQL)
      .bind(RECOVERY_CLASSIFIER_VERSION, limit)
      .all<OutdatedTransactionRow>();
  }
  if (outdated.results.length === 0) return { transactions: 0, outputs: 0, missing: 0 };

  let outputs = 0;
  let missing = 0;
  const prepared = await mapWithLimit(outdated.results, async (row) => {
    const [object, existingSpends] = await Promise.all([
      env.RECOVERY_TRANSACTIONS.get(`transactions/${row.txid}.hex`),
      env.RECOVERY_DB.prepare(
        `SELECT vout,spent_by_txid,spent_height FROM recovery_outputs
          WHERE txid=? AND spent_by_txid IS NOT NULL`,
      )
        .bind(row.txid)
        .all<ExistingSpendRow>(),
    ]);
    if (!object) return null;
    const rawHex = await object.text();
    return {
      row,
      rawHex,
      candidates: retainRecoverySpendEvidence(
        recoveryCandidates(rawHex, row.block_height ?? 0, row.block_time),
        existingSpends.results,
      ),
    };
  });

  for (const item of prepared) {
    if (!item) {
      // The R2 audit owns body coverage; skipping here keeps one absent body from stalling the sweep.
      missing++;
      continue;
    }
    if (item.candidates.length === 0) continue;
    outputs += await importRecoveryTransactions(env, [
      { txid: item.row.txid, raw_transaction_hex: item.rawHex, outputs: item.candidates },
    ]);
  }
  return { transactions: outdated.results.length - missing, outputs, missing };
}
