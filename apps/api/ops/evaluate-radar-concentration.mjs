#!/usr/bin/env node

/** Evaluate cutoff-safe concentration features against subsequent 180-day market persistence. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { percentileRanks } from "./lib/reputation-snapshot.mjs";

const root = resolve(".analytics/radar/ownership");
const snapshot = JSON.parse(readFileSync(resolve(root, "concentration.json"), "utf8"));
const trades = JSON.parse(readFileSync(resolve(root, "trade-history.json"), "utf8"));
if (!snapshot.complete || !trades.complete) throw new Error("Concentration and trade snapshots must be complete");
const horizonSeconds = 180 * 86400;
const db = new DatabaseSync(resolve(root, "ownership.sqlite"), { readOnly: true });

function cohort(cutoff) {
  return db
    .prepare(
      `WITH past AS (
      SELECT asset_id,COUNT(*) past_sales,COUNT(DISTINCT buyer_id) past_buyers,
        COUNT(DISTINCT seller_id) past_sellers,
        COUNT(DISTINCT strftime('%Y-%m',block_time,'unixepoch')) past_active_months,
        MAX(block_time) last_sale_time
      FROM market_trades WHERE asset_id IS NOT NULL AND block_time>0 AND block_time<=?
      GROUP BY asset_id
    ), future AS (
      SELECT asset_id,COUNT(*) future_sales,COUNT(DISTINCT buyer_id) future_buyers,
        COUNT(DISTINCT strftime('%Y-%m',block_time,'unixepoch')) future_active_months
      FROM market_trades WHERE asset_id IS NOT NULL AND block_time>? AND block_time<=?
      GROUP BY asset_id
    )
    SELECT concentration.asset_id id,past.*,COALESCE(future.future_sales,0) future_sales,
      COALESCE(future.future_buyers,0) future_buyers,
      COALESCE(future.future_active_months,0) future_active_months,
      concentration.holders,concentration.normalized_supply,
      concentration.top1_quantity*1.0/concentration.total_quantity top1_share,
      concentration.top5_quantity*1.0/concentration.total_quantity top5_share,
      concentration.creator_quantity*1.0/concentration.total_quantity creator_share,
      concentration.owner_quantity*1.0/concentration.total_quantity owner_share,
      concentration.largest_non_creator_quantity*1.0/concentration.total_quantity non_creator_top_share,
      concentration.largest_non_owner_quantity*1.0/concentration.total_quantity non_owner_top_share
    FROM historical_concentration concentration JOIN past USING(asset_id)
    LEFT JOIN future USING(asset_id)
    WHERE concentration.cutoff_label=? AND past.past_sales>=3 AND past.past_buyers>=2
      AND past.past_active_months>=2 AND concentration.total_quantity>0`,
    )
    .all(cutoff.timestamp, cutoff.timestamp, cutoff.timestamp + horizonSeconds, cutoff.label)
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])));
}

function evaluate(rows, name, score) {
  const ranked = [...rows].sort((a, b) => score(b) - score(a) || a.id - b.id);
  const topDecile = Math.max(1, Math.ceil(ranked.length / 10));
  const outcome = (row) => (row.future_sales > 0 ? 1 : 0);
  const persistent = (row) => (row.future_active_months >= 2 ? 1 : 0);
  const rate = (items, fn) => items.reduce((sum, row) => sum + fn(row), 0) / Math.max(1, items.length);
  const populationReturn = rate(ranked, outcome);
  const populationPersistent = rate(ranked, persistent);
  let hits = 0;
  let averagePrecision = 0;
  const positives = ranked.reduce((sum, row) => sum + outcome(row), 0);
  ranked.forEach((row, index) => {
    hits += outcome(row);
    if (outcome(row)) averagePrecision += hits / (index + 1);
  });
  return {
    predictor: name,
    eligible: ranked.length,
    population_return_rate: populationReturn,
    top_decile_return_rate: rate(ranked.slice(0, topDecile), outcome),
    return_lift: populationReturn ? rate(ranked.slice(0, topDecile), outcome) / populationReturn : 0,
    population_persistent_rate: populationPersistent,
    top_decile_persistent_rate: rate(ranked.slice(0, topDecile), persistent),
    persistence_lift: populationPersistent ? rate(ranked.slice(0, topDecile), persistent) / populationPersistent : 0,
    precision_at_100: rate(ranked.slice(0, 100), outcome),
    average_precision: positives ? averagePrecision / positives : 0,
  };
}

function band(rows, name, predicate) {
  const selected = rows.filter(predicate);
  return {
    band: name,
    assets: selected.length,
    share: selected.length / rows.length,
    return_rate: selected.reduce((sum, row) => sum + (row.future_sales > 0 ? 1 : 0), 0) / Math.max(1, selected.length),
    persistent_rate:
      selected.reduce((sum, row) => sum + (row.future_active_months >= 2 ? 1 : 0), 0) / Math.max(1, selected.length),
  };
}

const evaluations = [];
for (const cutoff of snapshot.cutoffs) {
  const rows = cohort(cutoff);
  const percentiles = Object.fromEntries(
    [
      "last_sale_time",
      "past_active_months",
      "holders",
      "top1_share",
      "top5_share",
      "non_creator_top_share",
      "creator_share",
      "normalized_supply",
    ].map((field) => [field, percentileRanks(rows, field)]),
  );
  const p = (field, row) => percentiles[field].get(row.id);
  const predictors = {
    market_core: (row) => (p("last_sale_time", row) + p("past_active_months", row)) / 2,
    holder_breadth: (row) => p("holders", row),
    top1_safety: (row) => 1 - p("top1_share", row),
    top5_safety: (row) => 1 - p("top5_share", row),
    non_creator_safety: (row) => 1 - p("non_creator_top_share", row),
    creator_low_share: (row) => 1 - p("creator_share", row),
    creator_high_share: (row) => p("creator_share", row),
    small_supply: (row) => 1 - p("normalized_supply", row),
    market_plus_top1: (row) =>
      ((p("last_sale_time", row) + p("past_active_months", row)) / 2 + (1 - p("top1_share", row))) / 2,
    market_plus_top1_10pct: (row) =>
      ((p("last_sale_time", row) + p("past_active_months", row)) / 2) * 0.9 + (1 - p("top1_share", row)) * 0.1,
    market_plus_non_creator: (row) =>
      ((p("last_sale_time", row) + p("past_active_months", row)) / 2 + (1 - p("non_creator_top_share", row))) / 2,
    market_plus_distribution: (row) =>
      ((p("last_sale_time", row) + p("past_active_months", row)) / 2 + p("holders", row) + (1 - p("top1_share", row))) /
      3,
    market_plus_distribution_20pct: (row) =>
      ((p("last_sale_time", row) + p("past_active_months", row)) / 2) * 0.8 +
      p("holders", row) * 0.1 +
      (1 - p("top1_share", row)) * 0.1,
    market_plus_supply_distribution: (row) =>
      ((p("last_sale_time", row) + p("past_active_months", row)) / 2 +
        p("holders", row) +
        (1 - p("top1_share", row)) +
        (1 - p("normalized_supply", row))) /
      4,
  };
  evaluations.push({
    cutoff: cutoff.label,
    cohort: rows.length,
    predictors: Object.entries(predictors).map(([name, score]) => evaluate(rows, name, score)),
    supply_bands: [
      band(rows, "supply<=300", (row) => row.normalized_supply <= 300),
      band(rows, "300<supply<=1000", (row) => row.normalized_supply > 300 && row.normalized_supply <= 1000),
      band(rows, "supply>1000", (row) => row.normalized_supply > 1000),
    ],
    concentration_bands: [
      band(rows, "top1<25%", (row) => row.top1_share < 0.25),
      band(rows, "25%<=top1<50%", (row) => row.top1_share >= 0.25 && row.top1_share < 0.5),
      band(rows, "top1>=50%", (row) => row.top1_share >= 0.5),
    ],
    gates: [
      ["top1<50%", (row) => row.top1_share < 0.5],
      ["top1<75%", (row) => row.top1_share < 0.75],
      ["supply<=1000", (row) => row.normalized_supply <= 1000],
      ["top1<50% and supply<=1000", (row) => row.top1_share < 0.5 && row.normalized_supply <= 1000],
    ].map(([name, predicate]) => ({
      gate: name,
      retained: rows.filter(predicate).length,
      retained_share: rows.filter(predicate).length / rows.length,
      market_core: evaluate(
        rows.filter(predicate),
        "market_core",
        (row) => (p("last_sale_time", row) + p("past_active_months", row)) / 2,
      ),
    })),
  });
}
db.close();
const report = {
  schema: "xcp-radar-concentration-evaluation/1",
  horizon_days: 180,
  eligibility: "3+ prior sales, 2+ prior buyers, 2+ prior active months",
  evaluations,
};
writeFileSync(resolve(root, "concentration-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
