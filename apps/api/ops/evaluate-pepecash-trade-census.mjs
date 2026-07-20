#!/usr/bin/env node

/** Apply the frozen C2 rules to every completed PEPECASH-quoted Counterparty match. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const candidateInput = resolve(
  process.env.PEPECASH_CANDIDATE_INPUT || "../../docs/data/pepecash-usd-candidates-2026-07-18.json",
);
const agreementInput = resolve(
  process.env.PEPECASH_AGREEMENT_INPUT || "../../docs/data/pepecash-path-agreement-2026-07-18.json",
);
const output = process.env.PEPECASH_CENSUS_OUTPUT ? resolve(process.env.PEPECASH_CENSUS_OUTPUT) : null;
const candidates = JSON.parse(readFileSync(candidateInput, "utf8"));
const agreements = JSON.parse(readFileSync(agreementInput, "utf8"));
const byDay = new Map(candidates.days.map((row) => [row.day, row.paths]));
const agreementByDay = new Map(agreements.days.map((row) => [row.day, row]));

const matchSql = `SELECT lower(hex(match.tx0_hash)) || '_' || lower(hex(match.tx1_hash)) ref,
  date(match.block_time,'unixepoch') day,match.block_time,match.block_index,
  CASE WHEN forward.asset='PEPECASH' THEN backward.asset ELSE forward.asset END asset,
  CAST(CASE WHEN forward.asset='PEPECASH' THEN match.backward_quantity ELSE match.forward_quantity END AS REAL)
    / CASE WHEN COALESCE(sold.divisible,1)=1 THEN 1e8 ELSE 1 END quantity,
  CAST(CASE WHEN forward.asset='PEPECASH' THEN match.forward_quantity ELSE match.backward_quantity END AS REAL)/1e8 total_pepecash,
  CASE WHEN forward.asset='PEPECASH' THEN 'forward_quote' ELSE 'backward_quote' END orientation
FROM order_matches match
JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
LEFT JOIN assets sold ON sold.asset_id=CASE WHEN forward.asset='PEPECASH' THEN match.backward_asset_id ELSE match.forward_asset_id END
WHERE match.status='completed' AND match.block_time IS NOT NULL
  AND ((forward.asset='PEPECASH' AND backward.asset NOT IN ('XCP','BTC'))
    OR (backward.asset='PEPECASH' AND forward.asset NOT IN ('XCP','BTC')))
ORDER BY match.block_time,ref`;
const matches = [];
for (let offset = 0; ; offset += 4000) {
  const page = executeRemoteD1(`${matchSql} LIMIT 4000 OFFSET ${offset}`).rows;
  matches.push(...page);
  if (page.length < 4000) break;
}

function decision(match) {
  const paths = byDay.get(match.day) ?? [];
  const jpy = paths.find((path) => path.path_class === "PEPECASH→JPY→USD");
  const btc = paths.find((path) => path.path_class === "PEPECASH→BTC→USD");
  const agreement = agreementByDay.get(match.day);
  let reason = "admitted";
  if (!jpy && !btc) reason = "missing_market";
  else if (!jpy || !btc) reason = "missing_corroborating_path";
  else if (Math.min(jpy.executions, btc.executions) < 2) reason = "insufficient_activity";
  else if (agreement?.window_overlap !== "overlapping_windows") reason = "nonoverlapping_windows";
  else if (agreement.absolute_log_error > Math.log(1.25)) reason = "severe_disagreement";
  const admitted = reason === "admitted";
  return {
    ref: match.ref,
    day: match.day,
    block_time: Number(match.block_time),
    block_index: Number(match.block_index),
    asset: match.asset,
    quantity: Number(match.quantity),
    total_pepecash: Number(match.total_pepecash),
    orientation: match.orientation,
    admitted,
    reason,
    usd_value: admitted ? Number(match.total_pepecash) * jpy.usd : null,
    selected_path: admitted ? jpy.path_class : null,
    selected_usd_per_pepecash: admitted ? jpy.usd : null,
    corroborating_usd_per_pepecash: btc?.usd ?? null,
    absolute_log_error: agreement?.absolute_log_error ?? null,
    minimum_executions: agreement?.minimum_executions ?? null,
    minimum_volume_pepecash: agreement?.minimum_volume_pepecash ?? null,
    fx_age_days: jpy?.conversion_age_days ?? null,
  };
}

const rows = matches.map(decision);
const sum = (items, field) => items.reduce((total, row) => total + Number(row[field] ?? 0), 0);
function summary(items) {
  const admitted = items.filter((row) => row.admitted);
  return {
    matches: items.length,
    admitted: admitted.length,
    rejected: items.length - admitted.length,
    coverage_pct: items.length ? (100 * admitted.length) / items.length : null,
    pepecash_total: sum(items, "total_pepecash"),
    admitted_pepecash: sum(admitted, "total_pepecash"),
    admitted_usd: sum(admitted, "usd_value"),
  };
}
const reasons = [
  "admitted",
  "missing_market",
  "missing_corroborating_path",
  "stale_fx",
  "insufficient_activity",
  "severe_disagreement",
  "nonoverlapping_windows",
  "invalid_orientation",
];
const years = [...new Set(rows.map((row) => row.day.slice(0, 4)))].sort();
const assets = [...new Set(rows.map((row) => row.asset))].sort();
const byAsset = Object.fromEntries(assets.map((asset) => [asset, summary(rows.filter((row) => row.asset === asset))]));
const report = {
  schema: "pepecash-trade-admission-census/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  frozen_rules: {
    requires_both_paths: true,
    minimum_executions_each: 2,
    requires_overlapping_windows: true,
    maximum_absolute_log_error: Math.log(1.25),
    selected_path: "PEPECASH→JPY→USD",
    market_carry_days: 0,
    ecb_max_age_days: 4,
    maximum_depth: 2,
  },
  overall: summary(rows),
  path_coverage: {
    both_paths: rows.filter((row) => agreementByDay.has(row.day)).length,
    jpy_only: rows.filter((row) => {
      const paths = byDay.get(row.day) ?? [];
      return (
        paths.some((path) => path.path_class.includes("JPY")) && !paths.some((path) => path.path_class.includes("BTC"))
      );
    }).length,
    btc_only: rows.filter((row) => {
      const paths = byDay.get(row.day) ?? [];
      return (
        paths.some((path) => path.path_class.includes("BTC")) && !paths.some((path) => path.path_class.includes("JPY"))
      );
    }).length,
    neither_path: rows.filter((row) => !byDay.get(row.day)?.length).length,
  },
  rejection_reasons: Object.fromEntries(
    reasons.map((reason) => [reason, summary(rows.filter((row) => row.reason === reason))]),
  ),
  years: Object.fromEntries(years.map((year) => [year, summary(rows.filter((row) => row.day.startsWith(year)))])),
  assets: {
    count: assets.length,
    with_admitted: Object.values(byAsset).filter((row) => row.admitted > 0).length,
    rows: byAsset,
  },
  review_samples: {
    largest_admitted: [...rows]
      .filter((row) => row.admitted)
      .sort((a, b) => b.usd_value - a.usd_value)
      .slice(0, 25),
    earliest: [...rows].slice(0, 25),
    severe_disagreement: [...rows]
      .filter((row) => row.reason === "severe_disagreement")
      .sort((a, b) => b.total_pepecash - a.total_pepecash)
      .slice(0, 25),
    thin_market: [...rows]
      .filter((row) => row.reason === "insufficient_activity")
      .sort((a, b) => b.total_pepecash - a.total_pepecash)
      .slice(0, 25),
  },
  matches: rows,
};
if (output) {
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ output, overall: report.overall, rejection_reasons: report.rejection_reasons, years: report.years, assets: { count: report.assets.count, with_admitted: report.assets.with_admitted } }, null, 2)}\n`,
  );
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
