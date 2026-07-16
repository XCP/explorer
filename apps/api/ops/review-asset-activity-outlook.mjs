#!/usr/bin/env node

/**
 * Review the persistence-core model where aggregate ranking metrics cannot: subgroup stability and named
 * false positives. Every feature ends at the cutoff and every outcome begins strictly after it.
 */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const CUTOFF = 1767225600; // 2026-01-01; newest fully observed 180-day window
const OUTCOME_END = CUTOFF + 180 * 86400;

const COHORT = `
WITH past AS (
  SELECT trade.asset_id,COUNT(*) past_sales,COUNT(DISTINCT trade.buyer_id) past_buyers,
    COUNT(DISTINCT strftime('%Y-%m',trade.block_time,'unixepoch')) past_active_months,
    MIN(trade.block_time) first_sale_time,MAX(trade.block_time) last_sale_time
  FROM trades trade WHERE trade.asset_id IS NOT NULL AND trade.block_time>0 AND trade.block_time<=${CUTOFF}
  GROUP BY trade.asset_id
), future AS (
  SELECT past.asset_id,COUNT(trade.ref) future_sales,
    COUNT(DISTINCT CASE WHEN trade.ref IS NOT NULL THEN strftime('%Y-%m',trade.block_time,'unixepoch') END)
      future_active_months
  FROM past LEFT JOIN trades trade ON trade.asset_id=past.asset_id
    AND trade.block_time>${CUTOFF} AND trade.block_time<=${OUTCOME_END}
  GROUP BY past.asset_id
), normalized AS (
  SELECT past.*,future.future_sales,future.future_active_months,
    PERCENT_RANK() OVER(ORDER BY past.last_sale_time) recency_pct,
    PERCENT_RANK() OVER(ORDER BY past.past_active_months) active_months_pct,
    NTILE(4) OVER(ORDER BY ${CUTOFF}-past.first_sale_time) age_quartile,
    NTILE(4) OVER(ORDER BY past.past_active_months) history_quartile
  FROM past JOIN future USING(asset_id)
), ranked AS (
  SELECT normalized.*,(recency_pct+active_months_pct)/2.0 outlook_score,
    ROW_NUMBER() OVER(ORDER BY (recency_pct+active_months_pct)/2.0 DESC,asset_id) rank_position,
    NTILE(10) OVER(ORDER BY (recency_pct+active_months_pct)/2.0 DESC,asset_id) score_decile
  FROM normalized
)
`;

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

export function buildReview(subgroups, cases, meta = {}) {
  return {
    schema: "xcp-asset-activity-outlook-review/1",
    generated_at: new Date().toISOString(),
    cutoff: CUTOFF,
    outcome_end: OUTCOME_END,
    horizon_days: 180,
    model: "equal mean of within-cutoff active-month and last-sale-time percentile ranks",
    subgroup_buckets: "within-cutoff quartiles/deciles; no hand-selected activity thresholds",
    subgroups,
    cases,
    d1: meta,
  };
}

function run() {
  const subgroupResult = executeRemoteD1(SUBGROUP_SQL);
  const caseResult = executeRemoteD1(REVIEW_SQL);
  process.stdout.write(
    `${JSON.stringify(
      buildReview(subgroupResult.rows, caseResult.rows, {
        rows_read: Number(subgroupResult.meta.rows_read ?? 0) + Number(caseResult.meta.rows_read ?? 0),
        sql_duration_ms:
          Number(subgroupResult.meta.timings?.sql_duration_ms ?? 0) +
          Number(caseResult.meta.timings?.sql_duration_ms ?? 0),
      }),
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) run();
