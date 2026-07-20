#!/usr/bin/env node

/** Evaluate explicitly lower-confidence PEPECASH lanes without changing the selected price calendar. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dispenserInput = resolve(
  process.env.PEPECASH_DISPENSER_INPUT || "../../docs/data/pepecash-dispenser-prices-2026-07-18.json",
);
const xcpInput = resolve(
  process.env.PEPECASH_XCP_ESTIMATOR_INPUT || "../../docs/data/pepecash-xcp-estimators-2026-07-18.json",
);
const censusInput = resolve(
  process.env.PEPECASH_CENSUS_INPUT || "../../docs/data/pepecash-trade-census-2026-07-18.json",
);
const output = process.env.PEPECASH_SPARSE_LANES_OUTPUT ? resolve(process.env.PEPECASH_SPARSE_LANES_OUTPUT) : null;

const dispenserReport = JSON.parse(readFileSync(dispenserInput, "utf8"));
const xcpReport = JSON.parse(readFileSync(xcpInput, "utf8"));
const census = JSON.parse(readFileSync(censusInput, "utf8"));
const dispensers = new Map(
  dispenserReport.days.filter((row) => row.executions >= 2 && row.dispensers >= 2).map((row) => [row.day, row]),
);
const xcp = new Map(
  xcpReport.estimates
    .filter((row) => row.method === "same_day_vwm" && row.executions >= 2)
    .map((row) => [row.day, row]),
);

const proportionalGap = (left, right) => Math.expm1(Math.abs(Math.log(left / right)));
const overlaps = [...dispensers].flatMap(([day, dispenser]) => {
  const dex = xcp.get(day);
  return dex
    ? [
        {
          day,
          dispenser_usd: dispenser.usd,
          xcp_usd: dex.usd,
          proportional_gap: proportionalGap(dispenser.usd, dex.usd),
        },
      ]
    : [];
});

const matches = census.matches.filter((row) => row.day > "2020-12-31");
const classified = matches.map((match) => {
  const dispenser = dispensers.get(match.day);
  const dex = xcp.get(match.day);
  const gap = dispenser && dex ? proportionalGap(dispenser.usd, dex.usd) : null;
  let evidence_class = "unavailable";
  let estimate = null;
  if (dispenser && dex && gap <= 0.1) {
    evidence_class = "dual_lane_selected";
    estimate = dispenser.usd;
  } else if (dispenser && dex) {
    evidence_class = "dual_lane_conflict";
  } else if (dispenser) {
    evidence_class = "dispenser_only_candidate";
    estimate = dispenser.usd;
  } else if (dex) {
    evidence_class = "xcp_dex_only_candidate";
    estimate = dex.usd;
  }
  return { ...match, evidence_class, estimate_usd_per_pepecash: estimate, proportional_gap: gap };
});

function summarize(rows) {
  const classes = {};
  for (const row of rows) classes[row.evidence_class] = (classes[row.evidence_class] ?? 0) + 1;
  return { matches: rows.length, classes };
}

// Leave-one-day-out interpolation measures within-lane temporal smoothness only. It is not independent price truth.
function interpolationBacktest(sourceRows, maxSpanDays) {
  const rows = [...sourceRows].sort((left, right) => left.day.localeCompare(right.day));
  const errors = [];
  for (let index = 1; index < rows.length - 1; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const next = rows[index + 1];
    const previousTime = Date.parse(`${previous.day}T00:00:00Z`);
    const currentTime = Date.parse(`${current.day}T00:00:00Z`);
    const nextTime = Date.parse(`${next.day}T00:00:00Z`);
    const spanDays = (nextTime - previousTime) / 86_400_000;
    if (spanDays > maxSpanDays) continue;
    const weight = (currentTime - previousTime) / (nextTime - previousTime);
    const estimate = Math.exp(Math.log(previous.usd) + weight * (Math.log(next.usd) - Math.log(previous.usd)));
    errors.push(proportionalGap(estimate, current.usd));
  }
  errors.sort((left, right) => left - right);
  const quantile = (fraction) => errors[Math.floor((errors.length - 1) * fraction)] ?? null;
  return {
    tested_days: errors.length,
    median_error: quantile(0.5),
    p90_error: quantile(0.9),
    within_25_percent: errors.length ? errors.filter((error) => error <= 0.25).length / errors.length : null,
    within_50_percent: errors.length ? errors.filter((error) => error <= 0.5).length / errors.length : null,
  };
}

function interpolationCoverage(sourceRows, targetRows, maxSpanDays) {
  const rows = [...sourceRows].sort((left, right) => left.day.localeCompare(right.day));
  const targets = new Set(targetRows.map((row) => row.day));
  const coveredDays = new Set();
  for (const day of targets) {
    let nextIndex = rows.findIndex((row) => row.day > day);
    if (nextIndex <= 0) continue;
    const previous = rows[nextIndex - 1];
    const next = rows[nextIndex];
    const spanDays = (Date.parse(`${next.day}T00:00:00Z`) - Date.parse(`${previous.day}T00:00:00Z`)) / 86_400_000;
    if (spanDays <= maxSpanDays) coveredDays.add(day);
  }
  return {
    payment_days: targets.size,
    covered_payment_days: coveredDays.size,
    matches: targetRows.length,
    covered_matches: targetRows.filter((row) => coveredDays.has(row.day)).length,
  };
}

const years = [...new Set(classified.map((row) => row.day.slice(0, 4)))].sort();
const report = {
  schema: "pepecash-sparse-lane-evaluation/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  caveat: "Single-lane values and interpolation are candidates, not selected prices or fair value.",
  rules: {
    dispenser_only: "same UTC day; >=2 completed executions; >=2 distinct sellers; no carry",
    xcp_dex_only: "same UTC day; >=2 completed executions; no carry",
    dual_lane_selected: "both eligible lanes and <=10% proportional disagreement",
  },
  overlap: {
    days: overlaps.length,
    within_10_percent: overlaps.filter((row) => row.proportional_gap <= 0.1).length,
    within_25_percent: overlaps.filter((row) => row.proportional_gap <= 0.25).length,
    over_50_percent: overlaps.filter((row) => row.proportional_gap > 0.5).length,
  },
  overall: summarize(classified),
  years: Object.fromEntries(
    years.map((year) => [year, summarize(classified.filter((row) => row.day.startsWith(year)))]),
  ),
  interpolation_backtest: Object.fromEntries(
    [3, 7, 14, 30].map((span) => [
      `${span}_day_span`,
      {
        dispenser: interpolationBacktest([...dispensers.values()], span),
        xcp_dex: interpolationBacktest([...xcp.values()], span),
      },
    ]),
  ),
  unavailable_interpolation_coverage: Object.fromEntries(
    [3, 7, 14].map((span) => {
      const unavailable = classified.filter((row) => row.evidence_class === "unavailable");
      return [
        `${span}_day_span`,
        {
          dispenser: interpolationCoverage([...dispensers.values()], unavailable, span),
          xcp_dex: interpolationCoverage([...xcp.values()], unavailable, span),
        },
      ];
    }),
  ),
};

if (output) writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
