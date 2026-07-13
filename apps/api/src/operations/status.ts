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

function stateMap(rows: StateRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * A cheap operational snapshot. Large recovery tables are only probed through
 * their chain-check index; exact import counters come from the tiny durable
 * import journal rather than recounting recovery outputs on every request.
 */
export async function operationalStatus(env: Env, now = Math.floor(Date.now() / 1000)) {
  const [ledgerRows, recoveryRows, imports, firstUnchecked, lastChecked, attempts] = await Promise.all([
    env.LEDGER_DB.prepare(
      `SELECT key,value FROM ledger_state
       WHERE key IN ('backfill_active','ledger_credit_cursor','ledger_credit_done',
                     'ledger_debit_cursor','ledger_debit_done','read_cutover')`,
    ).all<StateRow>(),
    env.RECOVERY_DB.prepare(`SELECT key,value,updated_at FROM recovery_state WHERE key='read_ready'`).all<StateRow>(),
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
      `SELECT COUNT(*) total,
              COALESCE(SUM(status='pending'),0) pending,
              COALESCE(SUM(chain_checked_at IS NULL),0) unchecked,
              MIN(chain_checked_at) oldest_check_at
       FROM recovery_attempts`,
    ).first<AttemptSummary>(),
  ]);

  const ledger = stateMap(ledgerRows.results);
  const recovery = stateMap(recoveryRows.results);
  const importCount = Number(imports?.imports ?? 0);
  const completedImports = Number(imports?.completed ?? 0);
  const hasUncheckedOutputs = firstUnchecked != null;

  return {
    generated_at: now,
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
        complete: importCount > 0 && completedImports === importCount && !hasUncheckedOutputs,
        has_unchecked_outputs: hasUncheckedOutputs,
        next_output: firstUnchecked ?? null,
        last_checked_at: lastChecked?.chain_checked_at ?? null,
      },
      attempts: {
        total: Number(attempts?.total ?? 0),
        pending: Number(attempts?.pending ?? 0),
        never_checked: Number(attempts?.unchecked ?? 0),
        oldest_check_at: attempts?.oldest_check_at ?? null,
      },
      read_ready: recovery.read_ready === "1",
    },
  };
}
