import type { Env } from "#api/env";
import { RECOVERY_SPEND_CONFIRMATIONS } from "#api/recovery/attempts";
import { RECOVERY_CLASSIFIER_VERSION } from "#api/recovery/classifier";
import { RECOVERY_REVERIFY_INTERVAL_SECONDS } from "#api/recovery/verify";

const DAY = 86_400;

/**
 * The recovery index's load-bearing invariant: once a recovery is confirmed deeply enough to settle,
 * none of the outputs it consumed may still be classified recoverable. Violations are exactly the
 * failure that hands an owner UTXOs their own confirmed transaction already spent, so their next
 * broadcast is rejected with bad-txns-inputs-missingorspent. It should sit at zero; a non-zero reading
 * that persists across a few maintenance passes means spend settlement has stopped working.
 */
export const RECOVERY_UNSETTLED_SQL = `
  SELECT COUNT(DISTINCT a.txid) attempts,COUNT(*) outputs,COALESCE(SUM(o.value_sats),0) sats
    FROM recovery_attempts a
    JOIN recovery_attempt_inputs i ON i.recovery_txid=a.txid
    JOIN recovery_outputs o ON o.txid=i.input_txid AND o.vout=i.input_vout
   WHERE a.status='confirmed' AND a.confirmations>=? AND o.classification='recoverable'`;

/** Settlement throughput. A live tool that recovers coins but settles none of them is broken. */
const RECOVERY_SETTLEMENT_SQL = `
  SELECT COUNT(*) outputs FROM recovery_outputs
   WHERE classification='spent' AND chain_checked_at>=?`;

/**
 * Verification coverage. `unverified` is never-checked work, which always takes priority; `reverification_due`
 * is the rolling backstop's backlog. Sizing RECOVERY_REVERIFY_INTERVAL_SECONDS is a judgement about how
 * long that backlog may take to drain at the Electrs budget, so both numbers belong next to each other.
 */
const RECOVERY_COVERAGE_SQL = `
  SELECT COUNT(DISTINCT txid) tracked_transactions,
         COUNT(DISTINCT CASE WHEN chain_checked_at IS NULL THEN txid END) unverified_transactions,
         COUNT(DISTINCT CASE WHEN classification='recoverable' AND chain_checked_at<=? THEN txid END)
           reverification_due_transactions,
         COUNT(DISTINCT CASE WHEN classifier_version<? THEN txid END) outdated_classifier_transactions
    FROM recovery_outputs`;

export interface RecoveryHealth {
  as_of: number;
  /** Every field here must read zero on a healthy index. */
  unsettled: { attempts: number; outputs: number; sats: number };
  settled_last_24h: number;
  coverage: {
    tracked_transactions: number;
    unverified_transactions: number;
    reverification_due_transactions: number;
    outdated_classifier_transactions: number;
    reverify_interval_seconds: number;
  };
  scan: { cursor: number; core_max_tx_index: number; lag: number };
}

export async function recoveryHealth(env: Env): Promise<RecoveryHealth> {
  const now = Math.floor(Date.now() / 1000);
  const [unsettled, settled, coverage, cursor, core] = await Promise.all([
    env.RECOVERY_DB.prepare(RECOVERY_UNSETTLED_SQL)
      .bind(RECOVERY_SPEND_CONFIRMATIONS)
      .first<{ attempts: number; outputs: number; sats: number }>(),
    env.RECOVERY_DB.prepare(RECOVERY_SETTLEMENT_SQL)
      .bind(now - DAY)
      .first<{ outputs: number }>(),
    env.RECOVERY_DB.prepare(RECOVERY_COVERAGE_SQL)
      .bind(now - RECOVERY_REVERIFY_INTERVAL_SECONDS, RECOVERY_CLASSIFIER_VERSION)
      .first<Record<string, number>>(),
    env.RECOVERY_DB.prepare(`SELECT value FROM recovery_state WHERE key='recovery_scan_tx_index'`).first<{
      value: string;
    }>(),
    env.CORE_DB.prepare(`SELECT COALESCE(MAX(tx_index),0) tx_index FROM transactions`).first<{ tx_index: number }>(),
  ]);

  const scanCursor = Number(cursor?.value ?? 0);
  const coreMax = Number(core?.tx_index ?? 0);
  return {
    as_of: now,
    unsettled: {
      attempts: Number(unsettled?.attempts ?? 0),
      outputs: Number(unsettled?.outputs ?? 0),
      sats: Number(unsettled?.sats ?? 0),
    },
    settled_last_24h: Number(settled?.outputs ?? 0),
    coverage: {
      tracked_transactions: Number(coverage?.tracked_transactions ?? 0),
      unverified_transactions: Number(coverage?.unverified_transactions ?? 0),
      reverification_due_transactions: Number(coverage?.reverification_due_transactions ?? 0),
      outdated_classifier_transactions: Number(coverage?.outdated_classifier_transactions ?? 0),
      reverify_interval_seconds: RECOVERY_REVERIFY_INTERVAL_SECONDS,
    },
    scan: { cursor: scanCursor, core_max_tx_index: coreMax, lag: Math.max(0, coreMax - scanCursor) },
  };
}
