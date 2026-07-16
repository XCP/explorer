#!/usr/bin/env node

/** Current-state integrity and drift audit for the materialized Asset Activity Outlook. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

export const OUTLOOK_INVARIANT_SQL = `
WITH eligible AS MATERIALIZED (
  SELECT asset_id,active_trade_months,last_trade_time FROM asset_signals
  WHERE active_trade_months>0 AND last_trade_time IS NOT NULL
), active_ordered AS (
  SELECT active_trade_months,ROW_NUMBER() OVER(ORDER BY active_trade_months) n,COUNT(*) OVER() total FROM eligible
), recency_ordered AS (
  SELECT unixepoch()-last_trade_time recency_seconds,
    ROW_NUMBER() OVER(ORDER BY unixepoch()-last_trade_time) n,COUNT(*) OVER() total FROM eligible
)
SELECT
  (SELECT COUNT(*) FROM eligible) eligible_assets,
  (SELECT COUNT(*) FROM asset_activity_outlook) projection_rows,
  (SELECT COUNT(*) FROM eligible LEFT JOIN asset_activity_outlook USING(asset_id)
    WHERE asset_activity_outlook.asset_id IS NULL) missing_rows,
  (SELECT COUNT(*) FROM asset_activity_outlook outlook LEFT JOIN eligible USING(asset_id)
    WHERE eligible.asset_id IS NULL) stale_rows,
  (SELECT COUNT(*) FROM asset_activity_outlook
    WHERE score<0 OR score>100 OR rank_position<1 OR rank_position>population
      OR population<1 OR calculated_at<1) invalid_rows,
  (SELECT COUNT(DISTINCT rank_position) FROM asset_activity_outlook) distinct_ranks,
  (SELECT MIN(rank_position) FROM asset_activity_outlook) min_rank,
  (SELECT MAX(rank_position) FROM asset_activity_outlook) max_rank,
  (SELECT COUNT(DISTINCT population) FROM asset_activity_outlook) distinct_populations,
  (SELECT MIN(population) FROM asset_activity_outlook) stored_population,
  (SELECT MIN(calculated_at) FROM asset_activity_outlook) oldest_calculated_at,
  (SELECT MAX(calculated_at) FROM asset_activity_outlook) newest_calculated_at,
  (SELECT ROUND(AVG(active_trade_months),2) FROM active_ordered
    WHERE n IN ((total+1)/2,(total/2)+1)) median_active_months,
  (SELECT ROUND(AVG(recency_seconds)/86400.0,2) FROM recency_ordered
    WHERE n IN ((total+1)/2,(total/2)+1)) median_recency_days`;

export const OUTLOOK_CONCENTRATION_SQL = `
WITH membership_ranked AS (
  SELECT dictionary.asset_id,tags.tag,
    ROW_NUMBER() OVER(PARTITION BY dictionary.asset_id ORDER BY
      CASE tags.source WHEN 'manual' THEN 1 WHEN 'collection' THEN 2 WHEN 'tokenscan' THEN 3
        WHEN 'digirare' THEN 4 WHEN 'issuer' THEN 5 ELSE 6 END,tags.tag) membership_rank
  FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
  JOIN asset_dictionary dictionary ON dictionary.asset=entity.entity_key
  WHERE entity.entity_type='asset'
    AND tags.source IN ('manual','collection','tokenscan','digirare','issuer','discovered')
), membership AS (
  SELECT asset_id,tag FROM membership_ranked WHERE membership_rank=1
)
SELECT COALESCE(membership.tag,'(unclassified)') collection,COUNT(*) assets,
  ROUND(100.0*COUNT(*)/(SELECT COUNT(*) FROM asset_activity_outlook WHERE rank_position<=100),1) pct
FROM asset_activity_outlook outlook LEFT JOIN membership USING(asset_id)
WHERE outlook.rank_position<=100
GROUP BY COALESCE(membership.tag,'(unclassified)') ORDER BY assets DESC,collection`;

export function buildOutlookAudit(invariants, concentration, meta = {}) {
  const healthy =
    Number(invariants.missing_rows) === 0 &&
    Number(invariants.stale_rows) === 0 &&
    Number(invariants.invalid_rows) === 0 &&
    Number(invariants.eligible_assets) === Number(invariants.projection_rows) &&
    Number(invariants.distinct_ranks) === Number(invariants.projection_rows) &&
    Number(invariants.min_rank) === 1 &&
    Number(invariants.max_rank) === Number(invariants.projection_rows) &&
    Number(invariants.distinct_populations) === 1 &&
    Number(invariants.stored_population) === Number(invariants.projection_rows);
  return {
    schema: "xcp-asset-activity-outlook-audit/1",
    generated_at: new Date().toISOString(),
    healthy,
    invariants,
    top_100_collection_concentration: concentration,
    d1: meta,
  };
}

function run() {
  const invariantResult = executeRemoteD1(OUTLOOK_INVARIANT_SQL);
  const concentrationResult = executeRemoteD1(OUTLOOK_CONCENTRATION_SQL);
  const report = buildOutlookAudit(invariantResult.rows[0] ?? {}, concentrationResult.rows, {
    rows_read: Number(invariantResult.meta.rows_read ?? 0) + Number(concentrationResult.meta.rows_read ?? 0),
    sql_duration_ms:
      Number(invariantResult.meta.timings?.sql_duration_ms ?? 0) +
      Number(concentrationResult.meta.timings?.sql_duration_ms ?? 0),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.healthy) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) run();
