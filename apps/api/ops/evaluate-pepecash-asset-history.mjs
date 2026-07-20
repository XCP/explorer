#!/usr/bin/env node

/** Evaluate PEPECASH USD candidates against causal, asset-specific PEPECASH payment history. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const census = JSON.parse(
  readFileSync(resolve(process.env.PEPECASH_CENSUS_INPUT || "../../docs/data/pepecash-trade-census-2026-07-18.json")),
);
const dispensers = JSON.parse(
  readFileSync(
    resolve(process.env.PEPECASH_DISPENSER_INPUT || "../../docs/data/pepecash-dispenser-prices-2026-07-18.json"),
  ),
);
const xcp = JSON.parse(
  readFileSync(resolve(process.env.PEPECASH_XCP_INPUT || "../../docs/data/pepecash-xcp-estimators-2026-07-18.json")),
);
const output = process.env.PEPECASH_ASSET_HISTORY_OUTPUT ? resolve(process.env.PEPECASH_ASSET_HISTORY_OUTPUT) : null;

const dispenserByDay = new Map(
  dispensers.days.filter((row) => row.executions >= 2 && row.dispensers >= 2).map((row) => [row.day, row]),
);
const xcpByDay = new Map(
  xcp.estimates.filter((row) => row.method === "same_day_vwm" && row.executions >= 2).map((row) => [row.day, row]),
);

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
};
const quantile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? null;
};
const ratioDistance = (value, reference) => Math.exp(Math.abs(Math.log(value / reference)));
const byAsset = new Map();
const evaluated = [];

for (const match of [...census.matches].sort(
  (left, right) => left.block_time - right.block_time || left.ref.localeCompare(right.ref),
)) {
  if (!(match.quantity > 0) || !(match.total_pepecash > 0)) continue;
  const unitPepecash = match.total_pepecash / match.quantity;
  const prior = byAsset.get(match.asset) ?? [];
  const priorMedian = median(prior.map((row) => row.unit_pepecash));
  const dispenser = dispenserByDay.get(match.day);
  const dex = xcpByDay.get(match.day);
  const gap = dispenser && dex ? Math.expm1(Math.abs(Math.log(dispenser.usd / dex.usd))) : null;
  let evidenceClass = match.admitted ? "zaif_selected" : "unavailable";
  let low = match.selected_usd_per_pepecash;
  let high = low;
  if (match.day > "2020-12-31") {
    if (dispenser && dex && gap <= 0.1) {
      evidenceClass = "dual_lane_selected";
      low = dispenser.usd;
      high = dispenser.usd;
    } else if (dispenser && dex) {
      evidenceClass = "dual_lane_conflict";
      low = Math.min(dispenser.usd, dex.usd);
      high = Math.max(dispenser.usd, dex.usd);
    } else if (dispenser) {
      evidenceClass = "dispenser_only_candidate";
      low = dispenser.usd;
      high = dispenser.usd;
    } else if (dex) {
      evidenceClass = "xcp_dex_only_candidate";
      low = dex.usd;
      high = dex.usd;
    }
  }
  const row = {
    ref: match.ref,
    day: match.day,
    asset: match.asset,
    quantity: match.quantity,
    total_pepecash: match.total_pepecash,
    unit_pepecash: unitPepecash,
    evidence_class: evidenceClass,
    usd_per_pepecash_low: low ?? null,
    usd_per_pepecash_high: high ?? null,
    payment_usd_low: low == null ? null : match.total_pepecash * low,
    payment_usd_high: high == null ? null : match.total_pepecash * high,
    prior_asset_trades: prior.length,
    prior_unit_pepecash_median: priorMedian,
    unit_pepecash_ratio_distance: priorMedian == null ? null : ratioDistance(unitPepecash, priorMedian),
  };
  evaluated.push(row);
  prior.push(row);
  byAsset.set(match.asset, prior);
}

const post = evaluated.filter((row) => row.day > "2020-12-31");
const candidates = post.filter((row) => row.evidence_class !== "unavailable");
const withHistory = candidates.filter((row) => row.prior_asset_trades > 0);
const distances = withHistory.map((row) => row.unit_pepecash_ratio_distance);
const assetSummaries = [...byAsset].map(([asset, rows]) => {
  const postRows = rows.filter((row) => row.day > "2020-12-31" && row.evidence_class !== "unavailable");
  const unitValues = rows.map((row) => row.unit_pepecash);
  return {
    asset,
    trades: rows.length,
    candidate_post2020_trades: postRows.length,
    first_day: rows[0].day,
    last_day: rows.at(-1).day,
    median_unit_pepecash: median(unitValues),
    p10_unit_pepecash: quantile(unitValues, 0.1),
    p90_unit_pepecash: quantile(unitValues, 0.9),
  };
});

function paymentSummary(rows) {
  const lows = rows.map((row) => row.payment_usd_low).filter((value) => value != null);
  const highs = rows.map((row) => row.payment_usd_high).filter((value) => value != null);
  const unitPrices = rows.map((row) => row.usd_per_pepecash_low).filter((value) => value != null);
  return {
    matches: rows.length,
    payment_usd_low: lows.reduce((sum, value) => sum + value, 0),
    payment_usd_high: highs.reduce((sum, value) => sum + value, 0),
    median_usd_per_pepecash: median(unitPrices),
    median_payment_usd: median(lows),
    p90_payment_usd_high: quantile(highs, 0.9),
  };
}

const postYears = [...new Set(post.map((row) => row.day.slice(0, 4)))].sort();

const report = {
  schema: "pepecash-asset-history-evaluation/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  methodology: {
    history: "strictly prior completed PEPECASH-quoted matches for the same purchased asset",
    normalization: "total PEPECASH divided by purchased quantity",
    warning: "asset-relative history diagnoses the purchase, not the PEPECASH/USD conversion",
  },
  coverage: {
    post2020_matches: post.length,
    contemporaneous_candidates: candidates.length,
    candidates_with_prior_asset_history: withHistory.length,
    candidates_without_prior_asset_history: candidates.length - withHistory.length,
    assets_with_candidates: new Set(candidates.map((row) => row.asset)).size,
  },
  causal_asset_history_distance: {
    median_ratio: quantile(distances, 0.5),
    p75_ratio: quantile(distances, 0.75),
    p90_ratio: quantile(distances, 0.9),
    within_2x: distances.filter((value) => value <= 2).length,
    within_10x: distances.filter((value) => value <= 10).length,
    observations: distances.length,
  },
  years: Object.fromEntries(
    postYears.map((year) => {
      const rows = post.filter((row) => row.day.startsWith(year));
      const classes = [...new Set(rows.map((row) => row.evidence_class))].sort();
      return [
        year,
        {
          all_candidates: paymentSummary(rows.filter((row) => row.evidence_class !== "unavailable")),
          classes: Object.fromEntries(
            classes.map((name) => [name, paymentSummary(rows.filter((row) => row.evidence_class === name))]),
          ),
        },
      ];
    }),
  ),
  largest_candidate_payments: [...candidates]
    .sort((left, right) => right.payment_usd_high - left.payment_usd_high)
    .slice(0, 50),
  largest_asset_history_deviations: [...withHistory]
    .sort((left, right) => right.unit_pepecash_ratio_distance - left.unit_pepecash_ratio_distance)
    .slice(0, 50),
  assets: assetSummaries
    .filter((row) => row.candidate_post2020_trades > 0)
    .sort((left, right) => right.candidate_post2020_trades - left.candidate_post2020_trades),
};

if (output) writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(
  `${JSON.stringify({ coverage: report.coverage, causal_asset_history_distance: report.causal_asset_history_distance, largest_candidate_payments: report.largest_candidate_payments.slice(0, 10) }, null, 2)}\n`,
);
