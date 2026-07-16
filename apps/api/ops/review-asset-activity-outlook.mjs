#!/usr/bin/env node

/**
 * Review the persistence-core model where aggregate ranking metrics cannot: subgroup stability and named
 * false positives. Every feature ends at the cutoff and every outcome begins strictly after it.
 */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

export const CUTOFF = 1767225600; // 2026-01-01; newest fully observed 180-day window
const horizonSeconds = 180 * 86400;
const OUTCOME_END = CUTOFF + horizonSeconds;

export function cohortSql(cutoff = CUTOFF) {
  const outcomeEnd = cutoff + horizonSeconds;
  return `
WITH past AS (
  SELECT trade.asset_id,COUNT(*) past_sales,COUNT(DISTINCT trade.buyer_id) past_buyers,
    COUNT(DISTINCT strftime('%Y-%m',trade.block_time,'unixepoch')) past_active_months,
    MIN(trade.block_time) first_sale_time,MAX(trade.block_time) last_sale_time
  FROM trades trade WHERE trade.asset_id IS NOT NULL AND trade.block_time>0 AND trade.block_time<=${cutoff}
  GROUP BY trade.asset_id
), future AS (
  SELECT past.asset_id,COUNT(trade.ref) future_sales,
    COUNT(DISTINCT CASE WHEN trade.ref IS NOT NULL THEN strftime('%Y-%m',trade.block_time,'unixepoch') END)
      future_active_months
  FROM past LEFT JOIN trades trade ON trade.asset_id=past.asset_id
    AND trade.block_time>${cutoff} AND trade.block_time<=${outcomeEnd}
  GROUP BY past.asset_id
), normalized AS (
  SELECT past.*,future.future_sales,future.future_active_months,
    PERCENT_RANK() OVER(ORDER BY past.last_sale_time) recency_pct,
    PERCENT_RANK() OVER(ORDER BY past.past_active_months) active_months_pct,
    NTILE(4) OVER(ORDER BY ${cutoff}-past.first_sale_time) age_quartile,
    NTILE(4) OVER(ORDER BY past.past_active_months) history_quartile
  FROM past JOIN future USING(asset_id)
), ranked AS (
  SELECT normalized.*,(recency_pct+active_months_pct)/2.0 outlook_score,
    ROW_NUMBER() OVER(ORDER BY (recency_pct+active_months_pct)/2.0 DESC,asset_id) rank_position,
    NTILE(10) OVER(ORDER BY (recency_pct+active_months_pct)/2.0 DESC,asset_id) score_decile
  FROM normalized
)
`;
}

const COHORT = cohortSql();

export const SUBGROUP_SQL = `${COHORT}
SELECT 'age_quartile' dimension,age_quartile bucket,COUNT(*) assets,
  ROUND(AVG(future_sales>0),6) return_rate,ROUND(AVG(future_active_months>=2),6) persistence_rate,
  ROUND(AVG(outlook_score),6) mean_score
FROM ranked GROUP BY age_quartile
UNION ALL
SELECT 'history_quartile',history_quartile,COUNT(*),ROUND(AVG(future_sales>0),6),
  ROUND(AVG(future_active_months>=2),6),ROUND(AVG(outlook_score),6)
FROM ranked GROUP BY history_quartile
UNION ALL
SELECT 'score_decile',score_decile,COUNT(*),ROUND(AVG(future_sales>0),6),
  ROUND(AVG(future_active_months>=2),6),ROUND(AVG(outlook_score),6)
FROM ranked GROUP BY score_decile
ORDER BY dimension,bucket`;

export const REVIEW_SQL = `${COHORT}
SELECT dictionary.asset,ranked.rank_position,ranked.past_sales,ranked.past_buyers,
  ranked.past_active_months,ranked.first_sale_time,ranked.last_sale_time,ranked.outlook_score,
  ranked.future_sales,ranked.future_active_months,
  CASE WHEN ranked.rank_position<=100 AND ranked.future_sales=0 THEN 'top_false_positive'
       WHEN ranked.rank_position>100 AND ranked.future_active_months>=2 THEN 'outside_top_persistent' END review_case
FROM ranked JOIN asset_dictionary dictionary USING(asset_id)
WHERE (ranked.rank_position<=100 AND ranked.future_sales=0)
   OR (ranked.rank_position>100 AND ranked.future_active_months>=2)
ORDER BY CASE WHEN ranked.rank_position<=100 THEN 0 ELSE 1 END,ranked.rank_position
LIMIT 200`;

const COLLECTION_MEMBERSHIP = `
, collection_ranked AS (
  SELECT dictionary.asset_id,tags.tag,
    ROW_NUMBER() OVER(PARTITION BY dictionary.asset_id ORDER BY
      CASE tags.source WHEN 'manual' THEN 1 WHEN 'collection' THEN 2 WHEN 'tokenscan' THEN 3
        WHEN 'digirare' THEN 4 WHEN 'issuer' THEN 5 ELSE 6 END,tags.tag) membership_rank
  FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
  JOIN asset_dictionary dictionary ON dictionary.asset=entity.entity_key
  WHERE entity.entity_type='asset'
    AND tags.source IN ('manual','collection','tokenscan','digirare','issuer','discovered')
), collection AS (
  SELECT asset_id,tag FROM collection_ranked WHERE membership_rank=1
), labeled AS (
  SELECT ranked.*,COALESCE(collection.tag,'(unclassified)') collection
  FROM ranked LEFT JOIN collection USING(asset_id)
)`;

export function collectionSql(cutoff = CUTOFF) {
  return `${cohortSql(cutoff).trimEnd()}${COLLECTION_MEMBERSHIP}
SELECT collection,COUNT(*) assets,SUM(rank_position<=100) top_100_assets,
  SUM(rank_position<=100 AND future_sales>0) top_100_returns,
  ROUND(AVG(future_sales>0),6) return_rate,ROUND(AVG(future_active_months>=2),6) persistence_rate
FROM labeled GROUP BY collection
ORDER BY top_100_assets DESC,assets DESC,collection`;
}

export const COLLECTION_SQL = collectionSql();

export function leaveCollectionOutSql(collection, cutoff = CUTOFF) {
  const escaped = String(collection).replaceAll("'", "''");
  return `${cohortSql(cutoff).trimEnd()}${COLLECTION_MEMBERSHIP}, filtered AS (
    SELECT * FROM labeled WHERE collection<>'${escaped}'
  ), reranked AS (
    SELECT filtered.*,ROW_NUMBER() OVER(ORDER BY outlook_score DESC,asset_id) filtered_rank,
      NTILE(10) OVER(ORDER BY outlook_score DESC,asset_id) filtered_decile
    FROM filtered
  )
  SELECT '${escaped}' excluded_collection,COUNT(*) assets,ROUND(AVG(future_sales>0),6) population_return_rate,
    ROUND(AVG(CASE WHEN filtered_rank<=100 THEN future_sales>0 END),6) precision_at_100,
    ROUND(AVG(CASE WHEN filtered_rank<=500 THEN future_sales>0 END),6) precision_at_500,
    ROUND(AVG(CASE WHEN filtered_decile=1 THEN future_sales>0 END),6) top_decile_return_rate,
    ROUND(AVG(CASE WHEN filtered_decile=1 THEN future_active_months>=2 END),6) top_decile_persistence_rate
  FROM reranked`;
}

export function buildReview(subgroups, cases, collections = [], leaveCollectionOut = null, meta = {}) {
  return {
    schema: "xcp-asset-activity-outlook-review/1",
    generated_at: new Date().toISOString(),
    cutoff: CUTOFF,
    outcome_end: OUTCOME_END,
    horizon_days: 180,
    model: "equal mean of within-cutoff active-month and last-sale-time percentile ranks",
    subgroup_buckets: "within-cutoff quartiles/deciles; no hand-selected activity thresholds",
    collection_note: "current collection labels are post-hoc diagnostic groups, never model features",
    subgroups,
    cases,
    collections,
    leave_collection_out: leaveCollectionOut,
    d1: meta,
  };
}

function run() {
  const subgroupResult = executeRemoteD1(SUBGROUP_SQL);
  const caseResult = executeRemoteD1(REVIEW_SQL);
  const collectionResult = executeRemoteD1(COLLECTION_SQL);
  const dominantCollection = collectionResult.rows.find((row) => row.collection !== "(unclassified)")?.collection;
  const leaveOutResult = dominantCollection
    ? executeRemoteD1(leaveCollectionOutSql(dominantCollection))
    : { rows: [], meta: {} };
  const parts = [subgroupResult, caseResult, collectionResult, leaveOutResult];
  process.stdout.write(
    `${JSON.stringify(
      buildReview(subgroupResult.rows, caseResult.rows, collectionResult.rows, leaveOutResult.rows[0] ?? null, {
        rows_read: parts.reduce((sum, part) => sum + Number(part.meta.rows_read ?? 0), 0),
        sql_duration_ms: parts.reduce((sum, part) => sum + Number(part.meta.timings?.sql_duration_ms ?? 0), 0),
      }),
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) run();
