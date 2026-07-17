import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

export const ACTIVITY_OUTLOOK_REFRESH_SECONDS = 86_400;

export const activityOutlookRefreshDue = (now: number, refreshedAt: number): boolean =>
  refreshedAt <= 0 || now - refreshedAt >= ACTIVITY_OUTLOOK_REFRESH_SECONDS;

/**
 * Materialize the validated two-factor persistence rank. This is a population-relative ordering, not a
 * probability: historical absolute return rates drift and collection activity is correlated.
 */
export const ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL = `INSERT INTO asset_activity_outlook(
  asset_id,score,rank_position,population,calculated_at
)
WITH normalized AS MATERIALIZED (
  SELECT asset_id,
    PERCENT_RANK() OVER(ORDER BY last_trade_time) recency_pct,
    PERCENT_RANK() OVER(ORDER BY active_trade_months) active_months_pct
  FROM asset_signals WHERE low_quality=0 AND active_trade_months>0 AND last_trade_time IS NOT NULL
), ranked AS (
  SELECT asset_id,100.0*(recency_pct+active_months_pct)/2.0 score,
    ROW_NUMBER() OVER(ORDER BY (recency_pct+active_months_pct)/2.0 DESC,asset_id) rank_position,
    COUNT(*) OVER() population
  FROM normalized
)
SELECT asset_id,score,rank_position,population,?1 FROM ranked WHERE 1
ON CONFLICT(asset_id) DO UPDATE SET score=excluded.score,rank_position=excluded.rank_position,
  population=excluded.population,calculated_at=excluded.calculated_at`;

export const ASSET_ACTIVITY_OUTLOOK_RECONCILE_SQL = `DELETE FROM asset_activity_outlook AS outlook
  WHERE NOT EXISTS (
    SELECT 1 FROM asset_signals signal WHERE signal.asset_id=outlook.asset_id
      AND signal.low_quality=0 AND signal.active_trade_months>0 AND signal.last_trade_time IS NOT NULL
  )`;

export async function refreshAssetActivityOutlook(db: D1Database, now = Math.floor(Date.now() / 1_000)) {
  const [result] = await db.batch([
    db.prepare(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL).bind(now),
    db.prepare(ASSET_ACTIVITY_OUTLOOK_RECONCILE_SQL),
  ]);
  await setCoreState(db, "asset_activity_outlook_refreshed_at", now);
  return { refreshed: true, rowsWritten: result.meta.changes, calculatedAt: now };
}

export async function maybeRefreshAssetActivityOutlook(db: D1Database, now = Math.floor(Date.now() / 1_000)) {
  const refreshedAt = await getCoreStateInt(db, "asset_activity_outlook_refreshed_at");
  if (!activityOutlookRefreshDue(now, refreshedAt)) return { refreshed: false, refreshedAt };
  return refreshAssetActivityOutlook(db, now);
}
