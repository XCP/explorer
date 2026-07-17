#!/usr/bin/env node

/**
 * Production audit for the materialized Address Reputation model.
 *
 * This is descriptive-model validation, not a predictive backtest: it verifies the comparison contract,
 * classifications, distribution, family coverage, and sensitivity to removing any one evidence family.
 */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const run = (sql) => executeRemoteD1(sql).rows;

const summary = run(`SELECT COUNT(*) population,MIN(reputation) minimum,MAX(reputation) maximum,
  AVG(reputation) mean,COUNT(DISTINCT population) population_values,COUNT(DISTINCT calculated_at) refreshes,
  COUNT(DISTINCT model_version) model_versions,
  SUM(reputation>=99) exceptional,SUM(reputation>=90 AND reputation<99) strong,
  SUM(reputation>=50 AND reputation<90) established,SUM(reputation<50) limited
FROM address_reputations`)[0];

const invalid = run(`SELECT COUNT(*) invalid_ranked
FROM address_reputations reputation JOIN address_signals signal USING(address_id)
WHERE signal.is_exchange=1 OR signal.is_deposit=1 OR signal.is_burn=1
  OR COALESCE(signal.is_emblem_vault,0)=1 OR COALESCE(signal.likely_service,0)=1
  OR COALESCE(signal.vault_scams,0)+COALESCE(signal.shell_scams,0)+COALESCE(signal.dump_scams,0)>0`)[0];

const classifications = run(`SELECT COUNT(*) total,
  SUM(is_exchange=1) exchanges,SUM(is_deposit=1) deposits,SUM(is_burn=1) burns,
  SUM(COALESCE(is_emblem_vault,0)=1) vaults,SUM(COALESCE(likely_service,0)=1) services,
  SUM(COALESCE(vault_scams,0)+COALESCE(shell_scams,0)+COALESCE(dump_scams,0)>0) integrity
FROM address_signals`)[0];

const families = run(`SELECT
  AVG(duration_score) duration_mean,SUM(duration_score=0) duration_zero,
  AVG(creation_score) creation_mean,SUM(creation_score=0) creation_zero,
  AVG(economic_score) economic_mean,SUM(economic_score=0) economic_zero,
  AVG(participation_score) participation_mean,SUM(participation_score=0) participation_zero
FROM address_reputations`)[0];

const sensitivity = run(`WITH ranks AS MATERIALIZED (
  SELECT rank_position base_rank,
    ROW_NUMBER() OVER(ORDER BY (creation_score+economic_score+participation_score)/3.0 DESC,address_id) no_duration,
    ROW_NUMBER() OVER(ORDER BY (duration_score+economic_score+participation_score)/3.0 DESC,address_id) no_creation,
    ROW_NUMBER() OVER(ORDER BY (duration_score+creation_score+participation_score)/3.0 DESC,address_id) no_economic,
    ROW_NUMBER() OVER(ORDER BY (duration_score+creation_score+economic_score)/3.0 DESC,address_id) no_participation
  FROM address_reputations
)
SELECT COUNT(*) population,
  ROUND(AVG(ABS(base_rank-no_duration)),1) no_duration_mean_shift,
  ROUND(AVG(ABS(base_rank-no_creation)),1) no_creation_mean_shift,
  ROUND(AVG(ABS(base_rank-no_economic)),1) no_economic_mean_shift,
  ROUND(AVG(ABS(base_rank-no_participation)),1) no_participation_mean_shift,
  SUM(base_rank<=100 AND no_duration<=100) no_duration_top100_overlap,
  SUM(base_rank<=100 AND no_creation<=100) no_creation_top100_overlap,
  SUM(base_rank<=100 AND no_economic<=100) no_economic_top100_overlap,
  SUM(base_rank<=100 AND no_participation<=100) no_participation_top100_overlap
FROM ranks`)[0];

const top = run(`SELECT dictionary.address,ROUND(reputation.reputation,1) reputation,
  reputation.rank_position,ROUND(reputation.duration_score,1) duration,
  ROUND(reputation.creation_score,1) creation,ROUND(reputation.economic_score,1) economic,
  ROUND(reputation.participation_score,1) participation
FROM address_reputations reputation JOIN address_dictionary dictionary USING(address_id)
ORDER BY reputation.rank_position LIMIT 25`);

const report = {
  generated_at: new Date().toISOString(),
  claim: "Relative strength of directly observed Counterparty track record",
  summary,
  invalid,
  classifications,
  families,
  leave_one_family_out: sensitivity,
  top,
};

if (Number(invalid.invalid_ranked) !== 0) throw new Error("Classified addresses entered the ranked population");
if (Number(summary.population_values) !== 1 || Number(summary.refreshes) !== 1 || Number(summary.model_versions) !== 1)
  throw new Error("Materialized model metadata is inconsistent");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
