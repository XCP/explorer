#!/usr/bin/env node

/** Causal PEPECASH/XCP estimator evaluation against Zaif JPY/USD, then post-2020 coverage projection. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const DAY_MS = 86_400_000;
const input = resolve(
  process.env.PEPECASH_CANDIDATE_INPUT || "../../docs/data/pepecash-usd-candidates-2026-07-18.json",
);
const output = process.env.PEPECASH_XCP_ESTIMATOR_OUTPUT ? resolve(process.env.PEPECASH_XCP_ESTIMATOR_OUTPUT) : null;
const zaif = JSON.parse(readFileSync(input, "utf8"));
const zaifJpy = new Map(
  zaif.days.flatMap((row) => {
    const path = row.paths.find((item) => item.path_class === "PEPECASH→JPY→USD");
    return path ? [[row.day, path]] : [];
  }),
);

const executions = executeRemoteD1(`SELECT date(match.block_time,'unixepoch') day,match.block_time,
  CASE WHEN forward.asset='PEPECASH'
    THEN CAST(match.backward_quantity AS REAL)/CAST(match.forward_quantity AS REAL)
    ELSE CAST(match.forward_quantity AS REAL)/CAST(match.backward_quantity AS REAL) END price_xcp,
  CASE WHEN forward.asset='PEPECASH' THEN CAST(match.forward_quantity AS INTEGER)
    ELSE CAST(match.backward_quantity AS INTEGER) END/1e8 volume_pepecash
FROM order_matches match
JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
WHERE match.status='completed' AND match.block_time IS NOT NULL
  AND CAST(match.forward_quantity AS INTEGER)>0 AND CAST(match.backward_quantity AS INTEGER)>0
  AND ((forward.asset='PEPECASH' AND backward.asset='XCP')
    OR (forward.asset='XCP' AND backward.asset='PEPECASH')) ORDER BY match.block_time`).rows.map((row) => ({
  ...row,
  block_time: Number(row.block_time),
  price_xcp: Number(row.price_xcp),
  volume_pepecash: Number(row.volume_pepecash),
}));
const executionsByDay = new Map();
for (const row of executions) {
  const group = executionsByDay.get(row.day) ?? [];
  group.push(row);
  executionsByDay.set(row.day, group);
}
const xcpRows = executeRemoteD1(
  `SELECT day,usd,source,observed_day FROM prices WHERE currency='XCP' ORDER BY day`,
).rows;
const xcpUsd = new Map(xcpRows.map((row) => [row.day, row]));
const paymentDays = executeRemoteD1(`SELECT date(match.block_time,'unixepoch') day,COUNT(*) matches
FROM order_matches match JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
WHERE match.status='completed' AND match.block_time IS NOT NULL
  AND ((forward.asset='PEPECASH' AND backward.asset NOT IN ('XCP','BTC'))
    OR (backward.asset='PEPECASH' AND forward.asset NOT IN ('XCP','BTC')))
GROUP BY 1 ORDER BY 1`).rows;

function weightedMedian(rows) {
  const sorted = [...rows].sort((a, b) => a.price_xcp - b.price_xcp);
  const total = sorted.reduce((sum, row) => sum + row.volume_pepecash, 0);
  let cumulative = 0;
  return sorted.find((row) => (cumulative += row.volume_pepecash) * 2 >= total)?.price_xcp ?? null;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}
function madFilter(rows) {
  if (rows.length < 5) return [];
  const logs = rows.map((row) => Math.log(row.price_xcp));
  const center = median(logs);
  const mad = median(logs.map((value) => Math.abs(value - center)));
  if (!(mad > 0)) return rows.filter((row) => Math.log(row.price_xcp) === center);
  const bound = 3 * 1.4826 * mad;
  return rows.filter((row) => Math.abs(Math.log(row.price_xcp) - center) <= bound);
}
const methods = [
  { name: "same_day_vwm", window: 1, filter: false },
  { name: "trailing_7d_vwm", window: 7, filter: false },
  { name: "trailing_14d_vwm", window: 14, filter: false },
  { name: "trailing_30d_vwm", window: 30, filter: false },
  { name: "trailing_14d_mad_vwm", window: 14, filter: true },
];
const firstDay = executions[0].day;
const lastDay = xcpRows.at(-1).day;
const days = [];
for (let time = Date.parse(`${firstDay}T00:00:00Z`); time <= Date.parse(`${lastDay}T00:00:00Z`); time += DAY_MS)
  days.push(new Date(time).toISOString().slice(0, 10));

const estimates = [];
for (const day of days) {
  const dayTime = Date.parse(`${day}T00:00:00Z`);
  const conversion = xcpUsd.get(day);
  if (!conversion) continue;
  for (const method of methods) {
    const raw = [];
    for (let age = 0; age < method.window; age += 1) {
      const windowDay = new Date(dayTime - age * DAY_MS).toISOString().slice(0, 10);
      raw.push(...(executionsByDay.get(windowDay) ?? []));
    }
    const used = method.filter ? madFilter(raw) : raw;
    if (!used.length) continue;
    const priceXcp = weightedMedian(used);
    const latest = Math.max(...used.map((row) => row.block_time));
    estimates.push({
      day,
      method: method.name,
      usd: priceXcp * Number(conversion.usd),
      price_xcp: priceXcp,
      executions: used.length,
      raw_executions: raw.length,
      volume_pepecash: used.reduce((sum, row) => sum + row.volume_pepecash, 0),
      latest_execution_time: latest,
      age_days: Math.floor(
        (dayTime - Date.parse(`${new Date(latest * 1000).toISOString().slice(0, 10)}T00:00:00Z`)) / DAY_MS,
      ),
      xcp_usd_source: conversion.source,
      xcp_usd_observed_day: conversion.observed_day,
    });
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? null;
}
function accuracy(rows) {
  const errors = rows.map((row) => row.absolute_log_error);
  return {
    days: rows.length,
    median_absolute_log_error: percentile(errors, 0.5),
    p90_absolute_log_error: percentile(errors, 0.9),
    p99_absolute_log_error: percentile(errors, 0.99),
    within_10_percent: rows.length
      ? (100 * errors.filter((value) => value <= Math.log(1.1)).length) / rows.length
      : null,
    within_25_percent: rows.length
      ? (100 * errors.filter((value) => value <= Math.log(1.25)).length) / rows.length
      : null,
  };
}
const validation = estimates.flatMap((estimate) => {
  const reference = zaifJpy.get(estimate.day);
  return reference
    ? [
        {
          ...estimate,
          reference_usd: reference.usd,
          absolute_log_error: Math.abs(Math.log(estimate.usd / reference.usd)),
          year: estimate.day.slice(0, 4),
        },
      ]
    : [];
});
const methodReports = Object.fromEntries(
  methods.map((method) => {
    const rows = validation.filter((row) => row.method === method.name);
    return [
      method.name,
      {
        overall: accuracy(rows),
        years: Object.fromEntries(
          [...new Set(rows.map((row) => row.year))]
            .sort()
            .map((year) => [year, accuracy(rows.filter((row) => row.year === year))]),
        ),
        age: Object.fromEntries(
          [0, 1, 2, 3, 4, 5, 6, 7, 14, 30].map((age) => [age, accuracy(rows.filter((row) => row.age_days === age))]),
        ),
      },
    ];
  }),
);
const post2020 = paymentDays.filter((row) => row.day > "2020-12-31");
const coverage = Object.fromEntries(
  methods.map((method) => {
    const available = new Set(
      estimates.filter((row) => row.method === method.name && row.day > "2020-12-31").map((row) => row.day),
    );
    const covered = post2020.filter((row) => available.has(row.day));
    return [
      method.name,
      {
        payment_days: post2020.length,
        covered_payment_days: covered.length,
        payment_day_coverage_pct: post2020.length ? (100 * covered.length) / post2020.length : null,
        matches: post2020.reduce((sum, row) => sum + Number(row.matches), 0),
        covered_matches: covered.reduce((sum, row) => sum + Number(row.matches), 0),
      },
    ];
  }),
);
const report = {
  schema: "pepecash-xcp-estimators/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  causal: true,
  predeclared_methods: methods,
  reference: "same-day Zaif PEPECASH/JPY converted with official ECB FX",
  method_reports: methodReports,
  post_2020_coverage: coverage,
  worst: Object.fromEntries(
    methods.map((method) => [
      method.name,
      validation
        .filter((row) => row.method === method.name)
        .sort((a, b) => b.absolute_log_error - a.absolute_log_error)
        .slice(0, 20),
    ]),
  ),
  estimates,
};
if (output) {
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ output, method_reports: report.method_reports, post_2020_coverage: report.post_2020_coverage }, null, 2)}\n`,
  );
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
