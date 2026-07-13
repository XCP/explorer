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
  const [coreRows, ledgerRows, recoveryRows, imports, firstUnchecked, lastChecked, verificationFailures, attempts] =
    await Promise.all([
      env.CORE_DB.prepare(
        `SELECT key,value FROM core_state
       WHERE key IN ('build_complete','import_complete','snapshot_consistent',
                     'snapshot_mode','snapshot_expected_tables','seed_event_index','last_event_index',
                     'seed_reconciled','parity_verified','forward_write_ready','read_surface_complete',
                     'projection_writes_ready')`,
      ).all<StateRow>(),
      env.LEDGER_DB.prepare(
        `SELECT key,value FROM ledger_state
       WHERE key IN ('backfill_active','ledger_credit_cursor','ledger_credit_done',
                     'ledger_debit_cursor','ledger_debit_done','read_cutover')`,
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
  const ledger = stateMap(ledgerRows.results);
  const recovery = stateMap(recoveryRows.results);
  const importCount = Number(imports?.imports ?? 0);
  const completedImports = Number(imports?.completed ?? 0);
  const hasUncheckedOutputs = firstUnchecked != null;
  const failedTransactions = Number(verificationFailures?.failed ?? 0);

  return {
    generated_at: now,
    core: {
      build_complete: core.build_complete === "1",
      import_complete: core.import_complete === "1",
      snapshot: {
        mode: core.snapshot_mode ?? null,
        consistent: core.snapshot_consistent === "1",
        expected_tables: core.snapshot_expected_tables == null ? null : Number(core.snapshot_expected_tables),
      },
      replay: {
        seed_event_index: core.seed_event_index == null ? null : Number(core.seed_event_index),
        last_event_index: core.last_event_index == null ? null : Number(core.last_event_index),
        reconciled: core.seed_reconciled === "1",
      },
      parity_verified: core.parity_verified === "1",
      forward_write_ready: core.forward_write_ready === "1",
      read_surface_complete: core.read_surface_complete === "1",
      projection_writes_ready: core.projection_writes_ready === "1",
      read_ready:
        core.build_complete === "1" &&
        core.import_complete === "1" &&
        core.seed_reconciled === "1" &&
        core.parity_verified === "1" &&
        core.forward_write_ready === "1" &&
        core.read_surface_complete === "1" &&
        core.projection_writes_ready === "1",
    },
    ledger: {
      backfill_active: ledger.backfill_active === "1",
      credit: { cursor: ledger.ledger_credit_cursor ?? null, complete: ledger.ledger_credit_done === "1" },
      debit: { cursor: ledger.ledger_debit_cursor ?? null, complete: ledger.ledger_debit_done === "1" },
      read_ready: ledger.read_cutover === "1",
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
