#!/usr/bin/env node

/** Evaluate predeclared XCP source-disagreement cohorts from an immutable B1 diagnostic snapshot. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const opsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(opsDirectory, "../../..");
const input = resolve(
  process.env.DIAGNOSTIC_INPUT || `${repositoryRoot}/docs/data/xcp-price-disagreement-2026-07-18.json`,
);
const output = process.env.COHORT_OUTPUT ? resolve(process.env.COHORT_OUTPUT) : null;
const diagnostic = JSON.parse(readFileSync(input, "utf8"));

function executionBucket(value) {
  return value <= 1 ? "1" : value < 10 ? "2-9" : "10+";
}

function volumeBucket(value) {
  return value < 100 ? "under_100_xcp" : value < 1000 ? "100-999_xcp" : "1000+_xcp";
}

const comparisons = diagnostic.days.flatMap((row) => {
  const cmc = row.candidates.find((candidate) => candidate.source === "coinmarketcap");
  if (!cmc) return [];
  const dexActive = row.candidates.some(
    (candidate) => candidate.source === "counterparty" && candidate.method === "volume_weighted_median",
  );
  return row.candidates
    .filter((candidate) => candidate !== cmc)
    .map((candidate) => ({
      day: row.day,
      year: row.day.slice(0, 4),
      path: `${candidate.source}:${candidate.path}`,
      candidate_usd: candidate.usd,
      cmc_usd: cmc.usd,
      absolute_log_error: Math.abs(Math.log(candidate.usd / cmc.usd)),
      executions: candidate.executions,
      execution_bucket: executionBucket(candidate.executions),
      volume_xcp: candidate.volume_xcp,
      volume_bucket: volumeBucket(candidate.volume_xcp),
      conversion_timing:
        candidate.conversion_age_days == null
          ? "direct"
          : candidate.conversion_age_days === 0
            ? "exact_day"
            : "carried",
      conversion_age_days: candidate.conversion_age_days ?? null,
      cmc_precision: cmc.precision,
      dex_activity: dexActive ? "dex_active" : "dex_inactive",
    }));
});

function summarize(rows) {
  const sorted = [...rows].sort((left, right) => left.absolute_log_error - right.absolute_log_error);
  const errors = sorted.map((row) => row.absolute_log_error);
  const percentile = (fraction) => errors[Math.floor((errors.length - 1) * fraction)] ?? null;
  const within = (fraction) =>
    sorted.length ? (100 * errors.filter((error) => error <= Math.log(1 + fraction)).length) / sorted.length : null;
  return {
    observations: sorted.length,
    mean_absolute_log_error: sorted.length ? errors.reduce((sum, error) => sum + error, 0) / sorted.length : null,
    median_absolute_log_error: percentile(0.5),
    p90_absolute_log_error: percentile(0.9),
    p99_absolute_log_error: percentile(0.99),
    within_10_percent: within(0.1),
    within_25_percent: within(0.25),
    worst: sorted
      .slice(-10)
      .reverse()
      .map((row) => ({
        day: row.day,
        path: row.path,
        candidate_usd: row.candidate_usd,
        cmc_usd: row.cmc_usd,
        absolute_log_error: row.absolute_log_error,
        executions: row.executions,
        volume_xcp: row.volume_xcp,
        conversion_age_days: row.conversion_age_days,
      })),
  };
}

function cohort(field) {
  const values = [...new Set(comparisons.map((row) => row[field]))].sort();
  return Object.fromEntries(
    values.map((value) => [value, summarize(comparisons.filter((row) => row[field] === value))]),
  );
}

const report = {
  schema: "xcp-price-disagreement-cohorts/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  input: { path: input, schema: diagnostic.schema, generated_at: diagnostic.generated_at },
  predeclared_cohorts: {
    execution_bucket: ["1", "2-9", "10+"],
    volume_bucket: ["under_100_xcp", "100-999_xcp", "1000+_xcp"],
    conversion_timing: ["direct", "exact_day", "carried"],
    cmc_precision: ["displayed_two_decimals", "api_precision"],
    dex_activity: ["dex_active", "dex_inactive"],
    path: "source and explicit conversion path",
    year: "UTC calendar year",
  },
  overall: summarize(comparisons),
  cohorts: {
    path: cohort("path"),
    execution_bucket: cohort("execution_bucket"),
    volume_bucket: cohort("volume_bucket"),
    conversion_timing: cohort("conversion_timing"),
    cmc_precision: cohort("cmc_precision"),
    dex_activity: cohort("dex_activity"),
    year: cohort("year"),
  },
};

if (output) {
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify(
      {
        output,
        comparisons: comparisons.length,
        overall: report.overall,
        cohorts: Object.fromEntries(
          Object.entries(report.cohorts).map(([name, values]) => [name, Object.keys(values)]),
        ),
      },
      null,
      2,
    )}\n`,
  );
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
