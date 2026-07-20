#!/usr/bin/env node

/** Build non-selecting daily XCP/USD candidates and factual cross-source disagreement diagnostics. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const DAY_MS = 86_400_000;
const CMC_PRECISE_API_START = "2023-07-19";
const rows = executeRemoteD1(`SELECT day,base_currency,quote_currency,source,venue,price,
    volume_base,trades,first_time,last_time,method
  FROM market_price_observations
  WHERE (base_currency='XCP' AND quote_currency IN ('USD','BTC','JPY'))
     OR (source='ecb' AND base_currency='EUR' AND quote_currency IN ('USD','JPY'))
  ORDER BY day,source,venue,quote_currency`).rows;
const btcUsdRows = executeRemoteD1(`SELECT day,usd,source,observed_day
  FROM prices WHERE currency='BTC' ORDER BY day`).rows;

const byKey = new Map();
for (const row of rows) byKey.set(`${row.day}:${row.source}:${row.venue}:${row.quote_currency}`, row);
const btcUsd = new Map(btcUsdRows.map((row) => [row.day, row]));
const xcpDays = [...new Set(rows.filter((row) => row.base_currency === "XCP").map((row) => row.day))].sort();

function priorDay(day, age) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - age * DAY_MS).toISOString().slice(0, 10);
}

function ecbCross(day) {
  for (let age = 0; age <= 4; age += 1) {
    const fxDay = priorDay(day, age);
    const usd = byKey.get(`${fxDay}:ecb:reference:USD`);
    const jpy = byKey.get(`${fxDay}:ecb:reference:JPY`);
    if (usd && jpy) return { day: fxDay, age, usdPerJpy: Number(usd.price) / Number(jpy.price) };
  }
  return null;
}

function directCandidate(row, source, path, extra = {}) {
  return {
    source,
    path,
    usd: Number(row.price),
    volume_xcp: Number(row.volume_base),
    executions: Number(row.trades),
    first_time: row.first_time == null ? null : Number(row.first_time),
    last_time: row.last_time == null ? null : Number(row.last_time),
    method: row.method,
    depth: 0,
    ...extra,
  };
}

function btcCandidate(row, source, path) {
  const btc = btcUsd.get(row.day);
  if (!btc) return null;
  return {
    source,
    path,
    usd: Number(row.price) * Number(btc.usd),
    volume_xcp: Number(row.volume_base),
    executions: Number(row.trades),
    first_time: row.first_time == null ? null : Number(row.first_time),
    last_time: row.last_time == null ? null : Number(row.last_time),
    method: row.method,
    depth: 1,
    conversion_source: btc.source,
    conversion_observed_day: btc.observed_day,
    conversion_age_days: Math.max(
      0,
      Math.round((Date.parse(`${row.day}T00:00:00Z`) - Date.parse(`${btc.observed_day}T00:00:00Z`)) / DAY_MS),
    ),
  };
}

function disagreement(candidates) {
  const errors = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      errors.push(Math.abs(Math.log(candidates[left].usd / candidates[right].usd)));
    }
  }
  const maximum = errors.length ? Math.max(...errors) : null;
  return {
    candidate_count: candidates.length,
    pair_count: errors.length,
    maximum_absolute_log_error: maximum,
    band:
      maximum == null
        ? "single_source"
        : maximum <= Math.log(1.1)
          ? "within_10_percent"
          : maximum <= Math.log(1.25)
            ? "within_25_percent"
            : "over_25_percent",
  };
}

const diagnostics = xcpDays.map((day) => {
  const candidates = [];
  const cmc = byKey.get(`${day}:coinmarketcap:aggregate:USD`);
  if (cmc)
    candidates.push(
      directCandidate(cmc, "coinmarketcap", "XCP→USD", {
        precision: day < CMC_PRECISE_API_START ? "displayed_two_decimals" : "api_precision",
      }),
    );

  const zaifJpy = byKey.get(`${day}:zaif:cex:JPY`);
  const fx = zaifJpy ? ecbCross(day) : null;
  if (zaifJpy && fx)
    candidates.push({
      ...directCandidate(zaifJpy, "zaif", "XCP→JPY→USD"),
      usd: Number(zaifJpy.price) * fx.usdPerJpy,
      depth: 1,
      conversion_source: "ecb",
      conversion_observed_day: fx.day,
      conversion_age_days: fx.age,
    });

  for (const [source, venue, label] of [
    ["zaif", "cex", "XCP→BTC→USD"],
    ["counterparty", "dex", "XCP→BTC→USD"],
    ["counterparty", "burn", "XCP→BTC→USD"],
    ["dex-trade", "cex", "XCP→BTC→USD"],
  ]) {
    const observation = byKey.get(`${day}:${source}:${venue}:BTC`);
    const candidate = observation ? btcCandidate(observation, source, label) : null;
    if (candidate) candidates.push(candidate);
  }

  return {
    day,
    candidates,
    disagreement: disagreement(candidates),
    flags: [
      ...(candidates.some((candidate) => candidate.executions > 0 && candidate.executions < 10) ? ["thin_venue"] : []),
      ...(candidates.some((candidate) => candidate.precision === "displayed_two_decimals")
        ? ["possible_quantization"]
        : []),
      ...(candidates.some((candidate) => Number(candidate.conversion_age_days) > 0) ? ["asynchronous_window"] : []),
    ],
  };
});

const bands = Object.fromEntries(
  ["single_source", "within_10_percent", "within_25_percent", "over_25_percent"].map((band) => [
    band,
    diagnostics.filter((row) => row.disagreement.band === band).length,
  ]),
);
const report = {
  schema: "xcp-price-disagreement/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  policy: {
    cmc_precise_api_start: CMC_PRECISE_API_START,
    ecb_max_age_days: 4,
    disagreement_metric: "maximum pairwise natural-log absolute error",
    bands: { within_10_percent: Math.log(1.1), within_25_percent: Math.log(1.25) },
  },
  summary: { days: diagnostics.length, bands },
  days: diagnostics,
};

if (process.env.DIAGNOSTIC_OUTPUT) {
  const output = resolve(process.env.DIAGNOSTIC_OUTPUT);
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ output, ...report.summary }, null, 2)}\n`);
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
