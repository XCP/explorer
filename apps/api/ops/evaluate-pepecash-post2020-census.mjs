#!/usr/bin/env node

/** Exact second-stage census for strict dispenser/BTC + DEX/XCP dual-market PEPECASH days. */
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
const output = process.env.PEPECASH_POST2020_OUTPUT ? resolve(process.env.PEPECASH_POST2020_OUTPUT) : null;
const dispenser = JSON.parse(readFileSync(dispenserInput, "utf8"));
const xcp = JSON.parse(readFileSync(xcpInput, "utf8"));
const zaifCensus = JSON.parse(readFileSync(censusInput, "utf8"));

const xcpByDay = new Map(xcp.estimates.filter((row) => row.method === "same_day_vwm").map((row) => [row.day, row]));
const days = dispenser.days.flatMap((btc) => {
  const xcpPath = xcpByDay.get(btc.day);
  if (btc.day <= "2020-12-31" || !xcpPath) return [];
  const absoluteLogError = Math.abs(Math.log(btc.usd / xcpPath.usd));
  const reasons = [
    ...(btc.executions < 2 ? ["insufficient_dispenser_executions"] : []),
    ...(btc.dispensers < 2 ? ["insufficient_dispenser_sellers"] : []),
    ...(xcpPath.executions < 2 ? ["insufficient_xcp_executions"] : []),
    ...(absoluteLogError > Math.log(1.1) ? ["over_10_percent_disagreement"] : []),
  ];
  return [
    {
      day: btc.day,
      admitted: reasons.length === 0,
      reasons,
      selected_path: "PEPECASH→BTC→USD (completed dispensers)",
      selected_usd_per_pepecash: btc.usd,
      dispenser_executions: btc.executions,
      distinct_dispenser_sellers: btc.dispensers,
      dispenser_volume_pepecash: btc.volume_pepecash,
      corroborating_path: "PEPECASH→XCP→USD (completed DEX matches)",
      corroborating_usd_per_pepecash: xcpPath.usd,
      xcp_executions: xcpPath.executions,
      xcp_volume_pepecash: xcpPath.volume_pepecash,
      absolute_log_error: absoluteLogError,
    },
  ];
});
const admittedDays = new Map(days.filter((row) => row.admitted).map((row) => [row.day, row]));

const matches = zaifCensus.matches
  .filter((row) => row.day > "2020-12-31")
  .map((row) => {
    const candidate = admittedDays.get(row.day);
    return {
      ref: row.ref,
      day: row.day,
      asset: row.asset,
      quantity: row.quantity,
      total_pepecash: row.total_pepecash,
      admitted: Boolean(candidate),
      reason: candidate ? "admitted_dual_market" : "no_admitted_dual_market_day",
      usd_value: candidate ? row.total_pepecash * candidate.selected_usd_per_pepecash : null,
      selected_usd_per_pepecash: candidate?.selected_usd_per_pepecash ?? null,
      absolute_log_error: candidate?.absolute_log_error ?? null,
    };
  });
const admittedMatches = matches.filter((row) => row.admitted);
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
const years = [...new Set(matches.map((row) => row.day.slice(0, 4)))].sort();
const summarize = (rows) => {
  const admitted = rows.filter((row) => row.admitted);
  return {
    matches: rows.length,
    admitted: admitted.length,
    coverage_pct: rows.length ? (100 * admitted.length) / rows.length : null,
    admitted_pepecash: sum(admitted, "total_pepecash"),
    admitted_usd: sum(admitted, "usd_value"),
  };
};
const report = {
  schema: "pepecash-post2020-dual-market-census/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  frozen_rule: {
    market_day: "exact UTC day; no carry",
    selected_path: "completed PEPECASH dispensers paid in BTC, daily PEPECASH-volume-weighted median",
    corroborating_path: "completed PEPECASH/XCP DEX matches, daily PEPECASH-volume-weighted median",
    minimum_executions_each: 2,
    minimum_distinct_dispenser_sellers: 2,
    maximum_absolute_log_error: Math.log(1.1),
  },
  candidate_days: {
    overlap: days.length,
    admitted: admittedDays.size,
    rejected: days.length - admittedDays.size,
  },
  overall: summarize(matches),
  years: Object.fromEntries(years.map((year) => [year, summarize(matches.filter((row) => row.day.startsWith(year)))])),
  assets: {
    admitted: new Set(admittedMatches.map((row) => row.asset)).size,
  },
  combined_with_zaif: {
    admitted_matches: zaifCensus.overall.admitted + admittedMatches.length,
    admitted_usd: zaifCensus.overall.admitted_usd + sum(admittedMatches, "usd_value"),
    overlap_matches: 0,
  },
  review: {
    largest: [...admittedMatches].sort((left, right) => right.usd_value - left.usd_value).slice(0, 25),
    earliest: admittedMatches.slice(0, 25),
    highest_disagreement: [...admittedMatches]
      .sort((left, right) => right.absolute_log_error - left.absolute_log_error)
      .slice(0, 25),
  },
  days,
  matches,
};

if (output) {
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify(
      {
        output,
        candidate_days: report.candidate_days,
        overall: report.overall,
        years: report.years,
        assets: report.assets,
        combined_with_zaif: report.combined_with_zaif,
      },
      null,
      2,
    )}\n`,
  );
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
