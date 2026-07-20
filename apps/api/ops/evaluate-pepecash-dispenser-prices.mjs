#!/usr/bin/env node

/** Evaluate attributable PEPECASH/BTC dispenser executions as a post-Zaif price source. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
const input = resolve(
  process.env.PEPECASH_CANDIDATE_INPUT || "../../docs/data/pepecash-usd-candidates-2026-07-18.json",
);
const output = process.env.PEPECASH_DISPENSER_OUTPUT ? resolve(process.env.PEPECASH_DISPENSER_OUTPUT) : null;
const zaif = JSON.parse(readFileSync(input, "utf8"));
const reference = new Map(
  zaif.days.flatMap((row) => {
    const path = row.paths.find((item) => item.path_class === "PEPECASH→JPY→USD");
    return path ? [[row.day, path.usd]] : [];
  }),
);
const daily = executeRemoteD1(`WITH raw AS (
 SELECT date(d.block_time,'unixepoch') day,CAST(d.btc_amount AS REAL)/CAST(d.dispense_quantity AS REAL) btc_per_pepecash,
   CAST(d.dispense_quantity AS REAL) volume_raw,d.source_id
 FROM dispenses d JOIN asset_dictionary a ON a.asset_id=d.asset_id
 WHERE a.asset='PEPECASH' AND d.block_time IS NOT NULL AND CAST(d.dispense_quantity AS INTEGER)>0 AND CAST(d.btc_amount AS INTEGER)>0
), counts AS (
 SELECT day,COUNT(*) executions,COUNT(DISTINCT source_id) dispensers FROM raw GROUP BY day
), ranked AS (
 SELECT raw.*,counts.executions,counts.dispensers,
  SUM(volume_raw) OVER(PARTITION BY raw.day ORDER BY btc_per_pepecash ROWS UNBOUNDED PRECEDING) cumulative,
  SUM(volume_raw) OVER(PARTITION BY raw.day) total_volume
 FROM raw JOIN counts USING(day)
)
SELECT day,MIN(btc_per_pepecash) btc_per_pepecash,MAX(total_volume)/1e8 volume_pepecash,
 MAX(executions) executions,MAX(dispensers) dispensers FROM ranked WHERE cumulative*2>=total_volume GROUP BY day ORDER BY day`).rows;
const btc = executeRemoteD1(`SELECT day,usd,source,observed_day FROM prices WHERE currency='BTC' ORDER BY day`).rows;
const btcUsd = new Map(btc.map((row) => [row.day, row]));
const paymentDays = executeRemoteD1(`SELECT date(m.block_time,'unixepoch') day,COUNT(*) matches FROM order_matches m
 JOIN asset_dictionary f ON f.asset_id=m.forward_asset_id JOIN asset_dictionary b ON b.asset_id=m.backward_asset_id
 WHERE m.status='completed' AND m.block_time IS NOT NULL AND ((f.asset='PEPECASH' AND b.asset NOT IN ('XCP','BTC')) OR (b.asset='PEPECASH' AND f.asset NOT IN ('XCP','BTC'))) GROUP BY 1`).rows;
const rows = daily.flatMap((row) => {
  const conversion = btcUsd.get(row.day);
  if (!conversion) return [];
  const usd = Number(row.btc_per_pepecash) * Number(conversion.usd);
  const expected = reference.get(row.day);
  return [
    {
      day: row.day,
      usd,
      btc_per_pepecash: Number(row.btc_per_pepecash),
      executions: Number(row.executions),
      dispensers: Number(row.dispensers),
      volume_pepecash: Number(row.volume_pepecash),
      btc_usd_source: conversion.source,
      reference_usd: expected ?? null,
      absolute_log_error: expected ? Math.abs(Math.log(usd / expected)) : null,
    },
  ];
});
function stats(items) {
  const errors = items
    .map((row) => row.absolute_log_error)
    .filter((value) => value != null)
    .sort((a, b) => a - b);
  return {
    days: items.length,
    validation_days: errors.length,
    median_absolute_log_error: errors[Math.floor((errors.length - 1) * 0.5)] ?? null,
    p90_absolute_log_error: errors[Math.floor((errors.length - 1) * 0.9)] ?? null,
    within_25_percent: errors.length
      ? (100 * errors.filter((value) => value <= Math.log(1.25)).length) / errors.length
      : null,
  };
}
const eligible = rows.filter((row) => row.executions >= 2 && row.dispensers >= 2);
const available = new Set(eligible.map((row) => row.day));
const post = paymentDays.filter((row) => row.day > "2020-12-31");
const covered = post.filter((row) => available.has(row.day));
const report = {
  schema: "pepecash-dispenser-prices/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  predeclared_candidate_rule: {
    minimum_executions: 2,
    minimum_distinct_dispensers: 2,
    price: "daily PEPECASH-volume-weighted median of completed BTC payments",
    carry_days: 0,
  },
  all: stats(rows),
  eligible: stats(eligible),
  post_2020_coverage: {
    payment_days: post.length,
    covered_payment_days: covered.length,
    matches: post.reduce((sum, row) => sum + Number(row.matches), 0),
    covered_matches: covered.reduce((sum, row) => sum + Number(row.matches), 0),
  },
  years: Object.fromEntries(
    [...new Set(rows.map((row) => row.day.slice(0, 4)))].map((year) => [
      year,
      stats(rows.filter((row) => row.day.startsWith(year))),
    ]),
  ),
  days: rows,
};
if (output) {
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ output, all: report.all, eligible: report.eligible, post_2020_coverage: report.post_2020_coverage, years: report.years }, null, 2)}\n`,
  );
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
