import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";
import { assetRankingEligibleSql } from "#api/reputation/eligibility";

export const ASSET_RATING_MODEL_VERSION = 1;
export const ASSET_RATING_REFRESH_SECONDS = 86_400;

export const assetRatingRefreshDue = (now: number, refreshedAt: number): boolean =>
  refreshedAt <= 0 || now - refreshedAt >= ASSET_RATING_REFRESH_SECONDS;

const ELIGIBLE = `${assetRankingEligibleSql("signal")}
  AND signal.clean_active_trade_months>0 AND signal.distinct_paid_buyers>0`;

/**
 * Materialize one literal Rating. Each evidence family first becomes a within-population percentile so dollars cannot
 * dominate counts merely through scale. Their equal mean is ranked once more, making Rating 8.2 mean the 82nd
 * percentile of the combined clean market record. It is not an event probability.
 */
export const ASSET_RATING_UPSERT_SQL = `INSERT INTO asset_ratings(
  asset_id,rating,rank_position,population,active_months_score,buyer_breadth_score,
  realized_value_score,calculated_at,model_version
)
WITH components AS MATERIALIZED (
  SELECT signal.asset_id,
    PERCENT_RANK() OVER(ORDER BY signal.clean_active_trade_months) active_months_pct,
    PERCENT_RANK() OVER(ORDER BY signal.distinct_paid_buyers) buyer_breadth_pct,
    PERCENT_RANK() OVER(ORDER BY signal.clean_realized_usd) realized_value_pct
  FROM asset_signals signal WHERE ${ELIGIBLE}
), combined AS MATERIALIZED (
  SELECT asset_id,active_months_pct,buyer_breadth_pct,realized_value_pct,
    (active_months_pct+buyer_breadth_pct+realized_value_pct)/3.0 evidence_rank
  FROM components
), ranked AS (
  SELECT asset_id,
    10.0*PERCENT_RANK() OVER(ORDER BY evidence_rank) rating,
    ROW_NUMBER() OVER(ORDER BY evidence_rank DESC,asset_id) rank_position,
    COUNT(*) OVER() population,
    100.0*active_months_pct active_months_score,
    100.0*buyer_breadth_pct buyer_breadth_score,
    100.0*realized_value_pct realized_value_score
  FROM combined
)
SELECT asset_id,rating,rank_position,population,active_months_score,buyer_breadth_score,
  realized_value_score,?1,${ASSET_RATING_MODEL_VERSION} FROM ranked WHERE 1
ON CONFLICT(asset_id) DO UPDATE SET rating=excluded.rating,rank_position=excluded.rank_position,
  population=excluded.population,active_months_score=excluded.active_months_score,
  buyer_breadth_score=excluded.buyer_breadth_score,realized_value_score=excluded.realized_value_score,
  previous_rating=asset_ratings.rating,previous_calculated_at=asset_ratings.calculated_at,
  calculated_at=excluded.calculated_at,model_version=excluded.model_version`;

export const ASSET_RATING_RECONCILE_SQL = `DELETE FROM asset_ratings AS rating
  WHERE NOT EXISTS (
    SELECT 1 FROM asset_signals signal WHERE signal.asset_id=rating.asset_id AND ${ELIGIBLE}
  )`;

export async function refreshAssetRatings(db: D1Database, now = Math.floor(Date.now() / 1_000)) {
  const [result] = await db.batch([
    db.prepare(ASSET_RATING_UPSERT_SQL).bind(now),
    db.prepare(ASSET_RATING_RECONCILE_SQL),
  ]);
  await setCoreState(db, "asset_ratings_refreshed_at", now);
  return {
    refreshed: true,
    rowsWritten: result.meta.changes,
    calculatedAt: now,
    modelVersion: ASSET_RATING_MODEL_VERSION,
  };
}

export async function maybeRefreshAssetRatings(db: D1Database, now = Math.floor(Date.now() / 1_000)) {
  const refreshedAt = await getCoreStateInt(db, "asset_ratings_refreshed_at");
  if (!assetRatingRefreshDue(now, refreshedAt)) return { refreshed: false, refreshedAt };
  return refreshAssetRatings(db, now);
}
