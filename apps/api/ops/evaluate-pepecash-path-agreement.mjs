#!/usr/bin/env node

/** Predeclared PEPECASH JPY/BTC path agreement cohorts; diagnostic only. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const input = resolve(
  process.env.PEPECASH_CANDIDATE_INPUT || "../../docs/data/pepecash-usd-candidates-2026-07-18.json",
);
const output = process.env.PEPECASH_AGREEMENT_OUTPUT ? resolve(process.env.PEPECASH_AGREEMENT_OUTPUT) : null;
const candidates = JSON.parse(readFileSync(input, "utf8"));

const dex = executeRemoteD1(`WITH raw AS (
  SELECT date(match.block_time,'unixepoch') day,
    CASE
      WHEN forward_asset.asset='PEPECASH' THEN backward_asset.asset
      ELSE forward_asset.asset END quote_currency,
    CASE
      WHEN forward_asset.asset='PEPECASH'
        THEN CAST(match.backward_quantity AS REAL)/CAST(match.forward_quantity AS REAL)
      ELSE CAST(match.forward_quantity AS REAL)/CAST(match.backward_quantity AS REAL) END price,
    CASE
      WHEN forward_asset.asset='PEPECASH' THEN CAST(match.forward_quantity AS INTEGER)
      ELSE CAST(match.backward_quantity AS INTEGER) END volume_base,
    match.block_time observation_time
  FROM order_matches match
  JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
  WHERE match.status='completed' AND match.block_time IS NOT NULL
    AND CAST(match.forward_quantity AS INTEGER)>0 AND CAST(match.backward_quantity AS INTEGER)>0
    AND ((forward_asset.asset='PEPECASH' AND backward_asset.asset IN ('BTC','XCP'))
      OR (backward_asset.asset='PEPECASH' AND forward_asset.asset IN ('BTC','XCP')))
), ranked AS (
  SELECT *,SUM(volume_base) OVER(PARTITION BY day,quote_currency ORDER BY price ROWS UNBOUNDED PRECEDING) cumulative,
    SUM(volume_base) OVER(PARTITION BY day,quote_currency) total_volume,
    COUNT(*) OVER(PARTITION BY day,quote_currency) executions,
    MIN(observation_time) OVER(PARTITION BY day,quote_currency) first_time,
    MAX(observation_time) OVER(PARTITION BY day,quote_currency) last_time
  FROM raw
)
SELECT day,quote_currency,MIN(price) price,MAX(total_volume)/1e8 volume_pepecash,MAX(executions) executions,
  MIN(first_time) first_time,MAX(last_time) last_time
FROM ranked WHERE cumulative*2>=total_volume GROUP BY day,quote_currency ORDER BY day,quote_currency`).rows;
const selected = executeRemoteD1(`SELECT day,currency,usd,source,observed_day FROM prices
  WHERE currency IN ('BTC','XCP') ORDER BY day,currency`).rows;
const usd = new Map(selected.map((row) => [`${row.day}:${row.currency}`, row]));

const executionBucket = (value) => (value <= 1 ? "1" : value < 10 ? "2-9" : "10+");
const volumeBucket = (value) => (value < 10_000 ? "under_10k" : value < 100_000 ? "10k_to_100k" : "100k_plus");
const overlapClass = (left, right) =>
  left.first_time <= right.last_time && right.first_time <= left.last_time ? "overlapping_windows" : "separate_windows";

const rows = candidates.days.flatMap((row) => {
  const jpy = row.paths.find((path) => path.path_class === "PEPECASH→JPY→USD");
  const btc = row.paths.find((path) => path.path_class === "PEPECASH→BTC→USD");
  if (!jpy || !btc) return [];
  const logError = Math.abs(Math.log(jpy.usd / btc.usd));
  return [
    {
      day: row.day,
      jpy_usd: jpy.usd,
      btc_usd: btc.usd,
      absolute_log_error: logError,
      ratio_jpy_to_btc: jpy.usd / btc.usd,
      disagreement_band:
        logError <= Math.log(1.1)
          ? "within_10_percent"
          : logError <= Math.log(1.25)
            ? "within_25_percent"
            : "over_25_percent",
      minimum_executions: Math.min(jpy.executions, btc.executions),
      minimum_volume_pepecash: Math.min(jpy.volume_pepecash, btc.volume_pepecash),
      execution_bucket: executionBucket(Math.min(jpy.executions, btc.executions)),
      volume_bucket: volumeBucket(Math.min(jpy.volume_pepecash, btc.volume_pepecash)),
      fx_age_bucket: jpy.conversion_age_days === 0 ? "exact_fx" : "carried_fx",
      window_overlap: overlapClass(jpy, btc),
      year: row.day.slice(0, 4),
    },
  ];
});

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? null;
}

function summary(items) {
  const errors = items.map((row) => row.absolute_log_error);
  return {
    days: items.length,
    median_absolute_log_error: percentile(errors, 0.5),
    p90_absolute_log_error: percentile(errors, 0.9),
    p99_absolute_log_error: percentile(errors, 0.99),
    within_10_percent: items.length
      ? (100 * errors.filter((error) => error <= Math.log(1.1)).length) / items.length
      : null,
    within_25_percent: items.length
      ? (100 * errors.filter((error) => error <= Math.log(1.25)).length) / items.length
      : null,
    severe_days: errors.filter((error) => error > Math.log(1.25)).length,
  };
}

function cohorts(field, declared) {
  return Object.fromEntries(declared.map((value) => [value, summary(rows.filter((row) => row[field] === value))]));
}

const corroboration = dex.flatMap((row) => {
  const conversion = usd.get(`${row.day}:${row.quote_currency}`);
  const offline = candidates.days.find((day) => day.day === row.day)?.paths ?? [];
  if (!conversion || !offline.length) return [];
  const dexUsd = Number(row.price) * Number(conversion.usd);
  return offline.map((path) => ({
    day: row.day,
    quote_currency: row.quote_currency,
    dex_usd: dexUsd,
    candidate_path: path.path_class,
    candidate_usd: path.usd,
    absolute_log_error: Math.abs(Math.log(dexUsd / path.usd)),
    dex_executions: Number(row.executions),
    dex_volume_pepecash: Number(row.volume_pepecash),
    conversion_source: conversion.source,
  }));
});

const severe = rows.filter((row) => row.disagreement_band === "over_25_percent");
let currentRun = 0;
let longestRun = 0;
let previous = null;
for (const row of severe) {
  const adjacent = previous && Date.parse(`${row.day}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === 86_400_000;
  currentRun = adjacent ? currentRun + 1 : 1;
  longestRun = Math.max(longestRun, currentRun);
  previous = row.day;
}

const report = {
  schema: "pepecash-path-agreement/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  predeclared_cohorts: {
    execution_bucket: ["1", "2-9", "10+"],
    volume_bucket: ["under_10k", "10k_to_100k", "100k_plus"],
    fx_age_bucket: ["exact_fx", "carried_fx"],
    window_overlap: ["overlapping_windows", "separate_windows"],
  },
  metric: "absolute natural-log error between same-day JPY and BTC path candidates",
  overall: summary(rows),
  cohorts: {
    execution_bucket: cohorts("execution_bucket", ["1", "2-9", "10+"]),
    volume_bucket: cohorts("volume_bucket", ["under_10k", "10k_to_100k", "100k_plus"]),
    fx_age_bucket: cohorts("fx_age_bucket", ["exact_fx", "carried_fx"]),
    window_overlap: cohorts("window_overlap", ["overlapping_windows", "separate_windows"]),
    year: cohorts("year", [...new Set(rows.map((row) => row.year))].sort()),
  },
  persistence: { severe_days: severe.length, longest_adjacent_severe_run_days: longestRun },
  worst: [...rows].sort((a, b) => b.absolute_log_error - a.absolute_log_error).slice(0, 25),
  corroboration: {
    claim: "on-chain observations are corroboration, not ground truth",
    summary: summary(corroboration),
    observations: corroboration,
  },
  days: rows,
};

if (output) {
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ output, overall: report.overall, persistence: report.persistence, cohorts: report.cohorts, corroboration: report.corroboration.summary }, null, 2)}\n`,
  );
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
