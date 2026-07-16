#!/usr/bin/env node

/** Evaluate whether cutoff concentration predicts dominant-holder inventory reduction over 180 days. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(".analytics/radar/ownership");
const concentration = JSON.parse(readFileSync(resolve(root, "concentration.json"), "utf8"));
const outcomes = JSON.parse(readFileSync(resolve(root, "holder-outcomes.json"), "utf8"));
if (!concentration.complete || !outcomes.complete) throw new Error("Holder outcome snapshots are incomplete");
const db = new DatabaseSync(resolve(root, "ownership.sqlite"), { readOnly: true });
const horizonSeconds = 180 * 86400;

function rowsFor(cutoff) {
  return db
    .prepare(`WITH past AS (
      SELECT asset_id,COUNT(*) past_sales,COUNT(DISTINCT buyer_id) past_buyers,
        COUNT(DISTINCT strftime('%Y-%m',block_time,'unixepoch')) past_active_months
      FROM market_trades WHERE asset_id IS NOT NULL AND block_time<=? GROUP BY asset_id
    ), future_sellers AS (
      SELECT trade.asset_id,
        SUM(trade.seller_id=tracked.top1_holder_id) observed_top1_sales,
        SUM(trade.seller_id=tracked.creator_id) observed_creator_sales,
        SUM(trade.seller_id=tracked.non_creator_holder_id) observed_non_creator_sales
      FROM holder_outcomes tracked JOIN market_trades trade ON trade.asset_id=tracked.asset_id
      WHERE tracked.cutoff_label=? AND trade.block_time>? AND trade.block_time<=?
      GROUP BY trade.asset_id
    )
    SELECT tracked.asset_id,concentration.holders,concentration.normalized_supply,
      concentration.divisible,CAST(concentration.total_quantity AS REAL) total_quantity,
      concentration.top1_quantity*1.0/concentration.total_quantity top1_share,
      concentration.creator_quantity*1.0/concentration.total_quantity creator_share,
      tracked.top1_holder_id=tracked.creator_id creator_is_top1,
      CAST(tracked.top1_start AS REAL) top1_start,CAST(tracked.top1_end AS REAL) top1_end,
      CAST(tracked.creator_start AS REAL) creator_start,CAST(tracked.creator_end AS REAL) creator_end,
      CAST(tracked.non_creator_start AS REAL) non_creator_start,
      CAST(tracked.non_creator_end AS REAL) non_creator_end,
      COALESCE(future_sellers.observed_top1_sales,0) observed_top1_sales,
      COALESCE(future_sellers.observed_creator_sales,0) observed_creator_sales,
      COALESCE(future_sellers.observed_non_creator_sales,0) observed_non_creator_sales
    FROM holder_outcomes tracked
    JOIN historical_concentration concentration USING(cutoff_label,asset_id)
    JOIN past USING(asset_id) LEFT JOIN future_sellers USING(asset_id)
    WHERE tracked.cutoff_label=? AND past.past_sales>=3 AND past.past_buyers>=2 AND past.past_active_months>=2`)
    .all(cutoff.timestamp, cutoff.label, cutoff.timestamp, cutoff.timestamp + horizonSeconds, cutoff.label)
    .map((row) => {
      const numeric = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
      const scale = numeric.divisible ? 1e8 : 1;
      numeric.top1_reduction = Math.max(0, numeric.top1_start - numeric.top1_end);
      numeric.top1_reduction_share = numeric.top1_start ? numeric.top1_reduction / numeric.top1_start : 0;
      numeric.top1_reduction_units = numeric.top1_reduction / scale;
      numeric.creator_reduction = Math.max(0, numeric.creator_start - numeric.creator_end);
      numeric.creator_reduction_share = numeric.creator_start ? numeric.creator_reduction / numeric.creator_start : 0;
      numeric.non_creator_reduction = Math.max(0, numeric.non_creator_start - numeric.non_creator_end);
      numeric.non_creator_reduction_share = numeric.non_creator_start
        ? numeric.non_creator_reduction / numeric.non_creator_start
        : 0;
      return numeric;
    });
}

function summarize(rows, name) {
  const rate = (predicate) => rows.filter(predicate).length / Math.max(1, rows.length);
  const values = rows.map((row) => row.top1_reduction_share).sort((a, b) => a - b);
  return {
    group: name,
    assets: rows.length,
    any_top1_reduction: rate((row) => row.top1_reduction > 0),
    top1_reduction_at_least_10pct: rate((row) => row.top1_reduction_share >= 0.1),
    top1_reduction_at_least_50pct: rate((row) => row.top1_reduction_share >= 0.5),
    top1_reduction_at_least_20_units: rate((row) => row.top1_reduction_units >= 20),
    observed_top1_sale: rate((row) => row.observed_top1_sales > 0),
    median_top1_reduction_share: values.length ? values[Math.floor(values.length / 2)] : 0,
  };
}

const evaluations = concentration.cutoffs.map((cutoff) => {
  const rows = rowsFor(cutoff);
  const high = rows.filter((row) => row.top1_share >= 0.5);
  return {
    cutoff: cutoff.label,
    cohort: rows.length,
    concentration: [
      summarize(rows.filter((row) => row.top1_share < 0.25), "top1<25%"),
      summarize(rows.filter((row) => row.top1_share >= 0.25 && row.top1_share < 0.5), "25%<=top1<50%"),
      summarize(high, "top1>=50%"),
    ],
    dominant_holder: [
      summarize(high.filter((row) => row.creator_is_top1 === 1), "creator is dominant"),
      summarize(high.filter((row) => row.creator_is_top1 === 0), "non-creator is dominant"),
    ],
    creator_dominant_future_reduction: {
      assets: high.filter((row) => row.creator_is_top1 === 1).length,
      creator_reduction_at_least_10pct:
        high.filter((row) => row.creator_is_top1 === 1 && row.creator_reduction_share >= 0.1).length /
        Math.max(1, high.filter((row) => row.creator_is_top1 === 1).length),
      observed_creator_sale:
        high.filter((row) => row.creator_is_top1 === 1 && row.observed_creator_sales > 0).length /
        Math.max(1, high.filter((row) => row.creator_is_top1 === 1).length),
    },
  };
});
db.close();
const report = {
  schema: "xcp-radar-holder-outcome-evaluation/1",
  horizon_days: 180,
  caveat:
    "Inventory reduction is potential sell pressure, not proof of sale; observed sales undercount origin-funded dispensers.",
  evaluations,
};
writeFileSync(resolve(root, "holder-outcome-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
