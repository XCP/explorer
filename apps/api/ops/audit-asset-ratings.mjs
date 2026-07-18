#!/usr/bin/env node

/** Production observability for the canonical materialized Rating projection. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const run = (sql) => executeRemoteD1(sql).rows;

const summary = run(`SELECT COUNT(*) population,ROUND(MIN(rating),2) minimum,
  ROUND(MAX(rating),2) maximum,ROUND(AVG(rating),2) mean,
  COUNT(DISTINCT population) population_values,COUNT(DISTINCT calculated_at) refreshes,
  COUNT(DISTINCT model_version) model_versions,MAX(calculated_at) calculated_at
FROM asset_ratings`)[0];

const distribution = run(`WITH bins(label,lower_bound,upper_bound) AS (
  VALUES('0–0.9',0,1),('1–1.9',1,2),('2–2.9',2,3),('3–3.9',3,4),('4–4.9',4,5),
        ('5–5.9',5,6),('6–6.9',6,7),('7–7.9',7,8),('8–8.9',8,9),('9–10',9,10.000001)
)
SELECT label,COUNT(rating.asset_id) count FROM bins
LEFT JOIN asset_ratings rating ON rating.rating>=lower_bound AND rating.rating<upper_bound
GROUP BY label,lower_bound ORDER BY lower_bound`);

const integrity = run(`SELECT COUNT(*) withheld
FROM asset_signals signal
WHERE COALESCE(signal.low_quality,0)=1`)[0];

const coverage = run(`WITH eligible AS (
  SELECT asset_id FROM asset_signals
  WHERE COALESCE(low_quality,0)=0 AND clean_active_trade_months>0 AND distinct_paid_buyers>0
)
SELECT (SELECT COUNT(*) FROM eligible) eligible,
  (SELECT COUNT(*) FROM eligible LEFT JOIN asset_ratings USING(asset_id) WHERE asset_ratings.asset_id IS NULL) missing,
  (SELECT COUNT(*) FROM asset_ratings LEFT JOIN eligible USING(asset_id) WHERE eligible.asset_id IS NULL) ineligible,
  (SELECT COUNT(*) FROM asset_ratings WHERE calculated_at<unixepoch()-172800) stale
`)[0];

const largestChanges = run(`SELECT dictionary.asset,ROUND(rating.previous_rating,2) previous_rating,
  ROUND(rating.rating,2) rating,ROUND(rating.rating-rating.previous_rating,2) change,
  rating.previous_calculated_at,rating.calculated_at
FROM asset_ratings rating JOIN asset_dictionary dictionary USING(asset_id)
WHERE rating.previous_rating IS NOT NULL AND rating.previous_calculated_at<rating.calculated_at
  AND ABS(rating.rating-rating.previous_rating)>=0.01
ORDER BY ABS(rating.rating-rating.previous_rating) DESC,rating.asset_id LIMIT 25`);

const report = {
  generated_at: new Date().toISOString(),
  claim: "Relative rank of clean demonstrated market evidence",
  summary,
  distribution,
  integrity_withheld: Number(integrity.withheld),
  coverage,
  largest_changes: largestChanges,
};

if (!Number(summary.population)) throw new Error("Rating projection is empty");
if (Number(summary.population_values) !== 1 || Number(summary.refreshes) !== 1 || Number(summary.model_versions) !== 1)
  throw new Error("Materialized Rating metadata is inconsistent");
if (Number(coverage.missing) || Number(coverage.ineligible) || Number(coverage.stale))
  throw new Error(`Rating projection coverage failed: ${JSON.stringify(coverage)}`);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
