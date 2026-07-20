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

interface OutlookIntegritySummary {
  rows: number;
  distinct_ranks: number;
  min_rank: number | null;
  max_rank: number | null;
  min_population: number | null;
  max_population: number | null;
  ineligible: number;
  calculated_at: number | null;
}

interface PricingHealthRow {
  currency: string;
  trades: number;
  missing: number;
  divergent: number;
  latest_price_day: string | null;
  latest_price_source: string | null;
  latest_observed_day: string | null;
  generated_at: number;
}

function stateMap(rows: StateRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

const DAY = 86_400;

function dayAge(day: string | null, now: number): number | null {
  if (day == null) return null;
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp / 1000) / DAY)) : null;
}

/**
 * A cheap operational snapshot. Large recovery tables are only probed through
 * their chain-check index; exact import counters come from the tiny durable
 * import journal rather than recounting recovery outputs on every request.
 */
export async function operationalStatus(env: Env, now = Math.floor(Date.now() / 1000)) {
  const [
    coreRows,
    outlook,
    pricingHealth,
    tradeTip,
    recoveryRows,
    imports,
    firstUnchecked,
    lastChecked,
    verificationFailures,
    attempts,
  ] = await Promise.all([
    env.CORE_DB.prepare(
      `SELECT key,value FROM core_state
       WHERE key IN ('last_event_index','last_block_index','last_block_hash','usd_cur')`,
    ).all<StateRow>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,COUNT(DISTINCT outlook.rank_position) distinct_ranks,
                MIN(outlook.rank_position) min_rank,MAX(outlook.rank_position) max_rank,
                MIN(outlook.population) min_population,MAX(outlook.population) max_population,
                COALESCE(SUM(CASE WHEN signal.low_quality=1 THEN 1 ELSE 0 END),0) ineligible,
                MAX(outlook.calculated_at) calculated_at
           FROM asset_activity_outlook outlook
           JOIN asset_signals signal ON signal.asset_id=outlook.asset_id`,
    ).first<OutlookIntegritySummary>(),
    env.CORE_DB.prepare(
      `SELECT currency,trades,missing,divergent,latest_price_day,
        latest_price_source,latest_observed_day,generated_at FROM pricing_health ORDER BY currency`,
    ).all<PricingHealthRow>(),
    env.CORE_DB.prepare(`SELECT MAX(rowid) tip FROM trades`).first<{ tip: number }>(),
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
  const outlookRows = Number(outlook?.rows ?? 0);
  const outlookHealthy =
    outlookRows > 0 &&
    Number(outlook?.ineligible ?? 0) === 0 &&
    Number(outlook?.distinct_ranks ?? 0) === outlookRows &&
    Number(outlook?.min_rank ?? 0) === 1 &&
    Number(outlook?.max_rank ?? 0) === outlookRows &&
    Number(outlook?.min_population ?? 0) === outlookRows &&
    Number(outlook?.max_population ?? 0) === outlookRows;
  const pricingRows = pricingHealth.results.map((row) => ({
    currency: row.currency,
    trades: Number(row.trades),
    missing: Number(row.missing),
    divergent: Number(row.divergent),
    latest_price_day: row.latest_price_day,
    latest_price_source: row.latest_price_source,
    latest_observed_day: row.latest_observed_day,
    latest_price_age_days: dayAge(row.latest_price_day, now),
    generated_at: Number(row.generated_at),
  }));
  const pricingGeneratedAt = Math.max(0, ...pricingRows.map((row) => row.generated_at));
  const pricingSnapshotAge = pricingGeneratedAt > 0 ? Math.max(0, now - pricingGeneratedAt) : null;
  const tradeTipValue = Number(tradeTip?.tip ?? 0);
  const usdCursor = Number(core.usd_cur ?? 0);
  const pricingPending = Math.max(0, tradeTipValue - usdCursor);
  const pricedCurrencies = new Set(pricingRows.map((row) => row.currency));
  const currentPriceRows = pricingRows.filter((row) => row.currency !== "USDC");
  const pricingHealthy =
    ["BTC", "ETH", "XCP", "USDC"].every((currency) => pricedCurrencies.has(currency)) &&
    pricingPending === 0 &&
    pricingSnapshotAge != null &&
    pricingSnapshotAge <= 2 * DAY &&
    pricingRows.every((row) => row.missing === 0 && row.divergent === 0) &&
    currentPriceRows.every((row) => row.latest_price_age_days != null && row.latest_price_age_days <= 2);

  return {
    generated_at: now,
    core: {
      replay: {
        last_event_index: core.last_event_index == null ? null : Number(core.last_event_index),
        last_block_index: core.last_block_index == null ? null : Number(core.last_block_index),
        last_block_hash: core.last_block_hash ?? null,
      },
      activity_outlook: {
        healthy: outlookHealthy,
        rows: outlookRows,
        ineligible: Number(outlook?.ineligible ?? 0),
        calculated_at: outlook?.calculated_at ?? null,
      },
      pricing: {
        healthy: pricingHealthy,
        reconciliation_cursor: usdCursor,
        trade_tip: tradeTipValue,
        pending_rows: pricingPending,
        snapshot_age_seconds: pricingSnapshotAge,
        currencies: pricingRows,
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
