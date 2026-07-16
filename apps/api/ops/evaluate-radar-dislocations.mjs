#!/usr/bin/env node

/** Evaluate robust completed-sale price dislocations and subsequent 180-day recovery. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { percentileRanks } from "./lib/reputation-snapshot.mjs";

const root = resolve(".analytics/radar/ownership");
const concentration = JSON.parse(readFileSync(resolve(root, "concentration.json"), "utf8"));
const trades = JSON.parse(readFileSync(resolve(root, "trade-history.json"), "utf8"));
if (!concentration.complete || !trades.complete) throw new Error("Radar analytical snapshots are incomplete");
const db = new DatabaseSync(resolve(root, "ownership.sqlite"), { readOnly: true });
const day = 86400;

function cohort(cutoff) {
  const referenceStart = cutoff.timestamp - 730 * day;
  const currentStart = cutoff.timestamp - 90 * day;
  const futureEnd = cutoff.timestamp + 180 * day;
  return db
    .prepare(`WITH priced AS MATERIALIZED (
      SELECT asset_id,block_time,buyer_id,usd_value/quantity unit_usd,
        strftime('%Y-%m',block_time,'unixepoch') month
      FROM market_trades WHERE venue IN ('dispense','dex')
        AND asset_id IS NOT NULL AND block_time>0 AND quantity>0 AND usd_value>0
        AND block_time>=? AND block_time<=?
    ), ref_ranked AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY asset_id,month ORDER BY unit_usd) rank,
        COUNT(*) OVER(PARTITION BY asset_id,month) month_sales
      FROM priced WHERE block_time<?
    ), monthly AS (
      SELECT asset_id,month,AVG(unit_usd) month_median,MAX(month_sales) month_sales
      FROM ref_ranked WHERE rank IN ((month_sales+1)/2,(month_sales+2)/2) GROUP BY asset_id,month
    ), reference_ranked AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY month_median) rank,
        COUNT(*) OVER(PARTITION BY asset_id) active_months
      FROM monthly
    ), reference AS (
      SELECT asset_id,AVG(month_median) reference_usd,MAX(active_months) reference_months,
        SUM(month_sales) reference_sales
      FROM reference_ranked WHERE rank IN ((active_months+1)/2,(active_months+2)/2) GROUP BY asset_id
    ), current_ranked AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY unit_usd) rank,
        COUNT(*) OVER(PARTITION BY asset_id) sales
      FROM priced WHERE block_time>=? AND block_time<=?
    ), current_price AS (
      SELECT asset_id,AVG(unit_usd) current_usd,MAX(sales) current_sales
      FROM current_ranked WHERE rank IN ((sales+1)/2,(sales+2)/2) GROUP BY asset_id
    ), future_ranked AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY unit_usd) rank,
        COUNT(*) OVER(PARTITION BY asset_id) sales
      FROM priced WHERE block_time>? AND block_time<=?
    ), future_price AS (
      SELECT asset_id,AVG(unit_usd) future_usd,MAX(sales) future_sales
      FROM future_ranked WHERE rank IN ((sales+1)/2,(sales+2)/2) GROUP BY asset_id
    )
    SELECT reference.asset_id id,reference.*,current_price.*,
      COALESCE(future_price.future_usd,0) future_usd,COALESCE(future_price.future_sales,0) future_sales,
      current_price.current_usd/reference.reference_usd dislocation_ratio,
      COALESCE(future_price.future_usd,0)/reference.reference_usd recovery_ratio,
      COALESCE(future_price.future_usd,0)/current_price.current_usd future_return_multiple,
      concentration.holders,concentration.normalized_supply,
      concentration.top1_quantity*1.0/concentration.total_quantity top1_share
    FROM reference JOIN current_price USING(asset_id) LEFT JOIN future_price USING(asset_id)
    JOIN historical_concentration concentration ON concentration.asset_id=reference.asset_id
      AND concentration.cutoff_label=?
    WHERE reference.reference_months>=2 AND reference.reference_sales>=3`)
    .all(
      referenceStart,
      futureEnd,
      currentStart,
      currentStart,
      cutoff.timestamp,
      cutoff.timestamp,
      futureEnd,
      cutoff.label,
    )
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])));
}

function summarize(rows, name) {
  const rate = (predicate) => rows.filter(predicate).length / Math.max(1, rows.length);
  const futureMultiples = rows.filter((row) => row.future_sales > 0).map((row) => row.future_return_multiple).sort((a, b) => a - b);
  return {
    band: name,
    assets: rows.length,
    future_sale_rate: rate((row) => row.future_sales > 0),
    recovery_to_75pct_rate: rate((row) => row.future_sales > 0 && row.recovery_ratio >= 0.75),
    recovery_to_reference_rate: rate((row) => row.future_sales > 0 && row.recovery_ratio >= 1),
    positive_return_rate: rate((row) => row.future_sales > 0 && row.future_return_multiple > 1),
    median_future_multiple: futureMultiples.length ? futureMultiples[Math.floor(futureMultiples.length / 2)] : 0,
  };
}

function rank(rows, name, score) {
  const ranked = [...rows].sort((a, b) => score(b) - score(a) || a.id - b.id);
  const top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 10)));
  const recovery = (row) => (row.future_sales > 0 && row.recovery_ratio >= 0.75 ? 1 : 0);
  const positive = (row) => (row.future_sales > 0 && row.future_return_multiple > 1 ? 1 : 0);
  const rate = (items, outcome) => items.reduce((sum, row) => sum + outcome(row), 0) / Math.max(1, items.length);
  const population = rate(ranked, recovery);
  const populationPositive = rate(ranked, positive);
  return {
    predictor: name,
    eligible: ranked.length,
    population_recovery_rate: population,
    top_decile_recovery_rate: rate(top, recovery),
    recovery_lift: population ? rate(top, recovery) / population : 0,
    recovery_precision_at_100: rate(ranked.slice(0, 100), recovery),
    population_positive_return_rate: populationPositive,
    top_decile_positive_return_rate: rate(top, positive),
    positive_return_lift: populationPositive ? rate(top, positive) / populationPositive : 0,
    positive_return_precision_at_100: rate(ranked.slice(0, 100), positive),
  };
}

const evaluations = concentration.cutoffs.map((cutoff) => {
  const rows = cohort(cutoff);
  const depth = percentileRanks(rows, "reference_months");
  const holders = percentileRanks(rows, "holders");
  const top1 = percentileRanks(rows, "top1_share");
  return {
    cutoff: cutoff.label,
    cohort: rows.length,
    bands: [
      summarize(rows.filter((row) => row.dislocation_ratio <= 0.25), "current<=25% reference"),
      summarize(rows.filter((row) => row.dislocation_ratio > 0.25 && row.dislocation_ratio <= 0.5), "25-50%"),
      summarize(rows.filter((row) => row.dislocation_ratio > 0.5 && row.dislocation_ratio <= 0.75), "50-75%"),
      summarize(rows.filter((row) => row.dislocation_ratio > 0.75 && row.dislocation_ratio <= 1), "75-100%"),
      summarize(rows.filter((row) => row.dislocation_ratio > 1), "above reference"),
    ],
    predictors: [
      rank(rows, "dislocation", (row) => -row.dislocation_ratio),
      rank(rows, "reference_depth", (row) => depth.get(row.id)),
      rank(rows, "holder_breadth", (row) => holders.get(row.id)),
      rank(rows, "dislocation_plus_depth", (row) =>
        (1 - Math.min(1, row.dislocation_ratio)) * 0.8 + depth.get(row.id) * 0.2),
      rank(rows, "dislocation_plus_safety", (row) =>
        (1 - Math.min(1, row.dislocation_ratio)) * 0.8 + (1 - top1.get(row.id)) * 0.2),
    ],
    confidence: [
      summarize(rows.filter((row) => row.current_sales === 1), "one current sale"),
      summarize(rows.filter((row) => row.current_sales >= 2), "2+ current sales"),
      summarize(rows.filter((row) => row.reference_months >= 4), "4+ reference months"),
    ],
  };
});
db.close();
const report = {
  schema: "xcp-radar-dislocation-evaluation/1",
  reference: "median of monthly median unit-USD prices from 730 to 90 days before cutoff",
  current: "median unit-USD completed sale in the final 90 days",
  outcome: "median unit-USD completed sale in the following 180 days",
  caveats: [
    "Completed-sale regimes validate the thesis but are not historical executable asks.",
    "Emblem sales are excluded because the vault sale feed does not expose Counterparty asset quantity; treating each vault as one asset unit can distort per-unit prices.",
  ],
  evaluations,
};
writeFileSync(resolve(root, "dislocation-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
