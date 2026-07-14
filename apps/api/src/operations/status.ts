import type { Env } from "#api/env";

interface StateRow {
  key: string;
  value: string;
  updated_at?: number;
}

interface ImportSummary {
  imports: number;
  completed: number;
  rows_seen: number;
  rows_written: number;
  started_at: number | null;
  last_completed_at: number | null;
  errors: number;
}

interface AttemptSummary {
  total: number;
  pending: number;
  unchecked: number;
  oldest_check_at: number | null;
}

interface VerificationFailureSummary {
  failed: number;
  retryable: number;
  next_retry_at: number | null;
  last_failed_at: number | null;
}

function stateMap(rows: StateRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * A cheap operational snapshot. Large recovery tables are only probed through
 * their chain-check index; exact import counters come from the tiny durable
 * import journal rather than recounting recovery outputs on every request.
 */
export async function operationalStatus(env: Env, now = Math.floor(Date.now() / 1000)) {
  const [coreRows, recoveryRows, imports, firstUnchecked, lastChecked, verificationFailures, attempts] =
    await Promise.all([
      env.CORE_DB.prepare(
        `SELECT key,value FROM core_state
       WHERE key IN ('last_event_index','last_block_index','last_block_hash')`,
      ).all<StateRow>(),
      env.RECOVERY_DB.prepare(
        `SELECT key,value,updated_at FROM recovery_state
          WHERE key IN ('read_ready','stamp_protection_ready','official_stamp_protection_ready','r2_audit_ready')`,
      ).all<StateRow>(),
      env.RECOVERY_DB.prepare(
        `SELECT COUNT(*) imports,
              COALESCE(SUM(completed_at IS NOT NULL),0) completed,
              COALESCE(SUM(rows_seen),0) rows_seen,
              COALESCE(SUM(rows_written),0) rows_written,
              MIN(started_at) started_at,
              MAX(completed_at) last_completed_at,
              COALESCE(SUM(error IS NOT NULL),0) errors
       FROM recovery_imports`,
      ).first<ImportSummary>(),
      env.RECOVERY_DB.prepare(
        `SELECT txid,vout FROM recovery_outputs
       WHERE chain_checked_at IS NULL ORDER BY chain_checked_at,txid,vout LIMIT 1`,
      ).first<{ txid: string; vout: number }>(),
      env.RECOVERY_DB.prepare(
        `SELECT chain_checked_at FROM recovery_outputs
       WHERE chain_checked_at IS NOT NULL ORDER BY chain_checked_at DESC,txid,vout LIMIT 1`,
      ).first<{ chain_checked_at: number }>(),
      env.RECOVERY_DB.prepare(
        `SELECT COUNT(*) failed,
              COALESCE(SUM(next_retry_at<=${now}),0) retryable,
              MIN(next_retry_at) next_retry_at,
              MAX(last_failed_at) last_failed_at
       FROM recovery_verification_failures`,
      ).first<VerificationFailureSummary>(),
      env.RECOVERY_DB.prepare(
        `SELECT COUNT(*) total,
              COALESCE(SUM(status='pending'),0) pending,
              COALESCE(SUM(chain_checked_at IS NULL),0) unchecked,
              MIN(chain_checked_at) oldest_check_at
       FROM recovery_attempts`,
      ).first<AttemptSummary>(),
    ]);

  const core = stateMap(coreRows.results);
  const recovery = stateMap(recoveryRows.results);
  const importCount = Number(imports?.imports ?? 0);
  const completedImports = Number(imports?.completed ?? 0);
  const hasUncheckedOutputs = firstUnchecked != null;
  const failedTransactions = Number(verificationFailures?.failed ?? 0);

  return {
    generated_at: now,
    core: {
      replay: {
        last_event_index: core.last_event_index == null ? null : Number(core.last_event_index),
        last_block_index: core.last_block_index == null ? null : Number(core.last_block_index),
        last_block_hash: core.last_block_hash ?? null,
      },
    },
    recovery: {
      import: {
        imports: importCount,
        completed: completedImports,
        rows_seen: Number(imports?.rows_seen ?? 0),
        rows_written: Number(imports?.rows_written ?? 0),
        started_at: imports?.started_at ?? null,
        last_completed_at: imports?.last_completed_at ?? null,
        errors: Number(imports?.errors ?? 0),
      },
      verification: {
        complete:
          importCount > 0 && completedImports === importCount && !hasUncheckedOutputs && failedTransactions === 0,
        has_unchecked_outputs: hasUncheckedOutputs,
        failed_transactions: failedTransactions,
        retryable_failures: Number(verificationFailures?.retryable ?? 0),
        next_retry_at: verificationFailures?.next_retry_at ?? null,
        last_failed_at: verificationFailures?.last_failed_at ?? null,
        next_output: firstUnchecked ?? null,
        last_checked_at: lastChecked?.chain_checked_at ?? null,
      },
      attempts: {
        total: Number(attempts?.total ?? 0),
        pending: Number(attempts?.pending ?? 0),
        never_checked: Number(attempts?.unchecked ?? 0),
        oldest_check_at: attempts?.oldest_check_at ?? null,
      },
      readiness: {
        stamp_protection: recovery.stamp_protection_ready === "1",
        official_stamp_protection: recovery.official_stamp_protection_ready === "1",
        r2_audit: recovery.r2_audit_ready === "1",
      },
      read_ready: recovery.read_ready === "1",
    },
  };
}
