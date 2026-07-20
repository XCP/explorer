#!/usr/bin/env node

/** Build non-selecting PEPECASH/USD candidates from the two predeclared Zaif path classes. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const DAY_MS = 86_400_000;
const output = process.env.PEPECASH_CANDIDATE_OUTPUT ? resolve(process.env.PEPECASH_CANDIDATE_OUTPUT) : null;

const observations = executeRemoteD1(`SELECT day,quote_currency,price,volume_base,trades,first_time,last_time,method
  FROM market_price_observations WHERE base_currency='PEPECASH' AND source='zaif' AND venue='cex'
    AND quote_currency IN ('BTC','JPY') ORDER BY day,quote_currency`).rows;
const btcRows = executeRemoteD1(`SELECT day,usd,source,observed_day FROM prices
  WHERE currency='BTC' ORDER BY day`).rows;
const ecbRows = executeRemoteD1(`SELECT day,quote_currency,price FROM market_price_observations
  WHERE source='ecb' AND venue='reference' AND base_currency='EUR'
    AND quote_currency IN ('JPY','USD') ORDER BY day,quote_currency`).rows;
const manifests = executeRemoteD1(`SELECT source,venue,dataset,source_url,sha256,rows
  FROM market_price_imports WHERE dataset IN ('pepecash_btc','pepecash_jpy') ORDER BY dataset,source_url`).rows;

const market = new Map(observations.map((row) => [`${row.day}:${row.quote_currency}`, row]));
const btc = new Map(btcRows.map((row) => [row.day, row]));
const ecb = new Map(ecbRows.map((row) => [`${row.day}:${row.quote_currency}`, Number(row.price)]));
const days = [...new Set(observations.map((row) => row.day))].sort();

function priorDay(day, age) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - age * DAY_MS).toISOString().slice(0, 10);
}

function ecbCross(day) {
  for (let age = 0; age <= 4; age += 1) {
    const observedDay = priorDay(day, age);
    const usd = ecb.get(`${observedDay}:USD`);
    const jpy = ecb.get(`${observedDay}:JPY`);
    if (usd > 0 && jpy > 0) return { observedDay, age, usdPerJpy: usd / jpy };
  }
  return null;
}

function evidence(row) {
  return {
    executions: Number(row.trades),
    volume_pepecash: Number(row.volume_base),
    first_time: row.first_time == null ? null : Number(row.first_time),
    last_time: row.last_time == null ? null : Number(row.last_time),
    method: row.method,
  };
}

const candidates = days.map((day) => {
  const paths = [];
  const btcMarket = market.get(`${day}:BTC`);
  const btcUsd = btc.get(day);
  if (btcMarket && btcUsd)
    paths.push({
      path_class: "PEPECASH→BTC→USD",
      usd: Number(btcMarket.price) * Number(btcUsd.usd),
      depth: 2,
      market_day: day,
      market_source: "zaif",
      conversion_source: btcUsd.source,
      conversion_observed_day: btcUsd.observed_day,
      conversion_age_days: Math.max(
        0,
        Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${btcUsd.observed_day}T00:00:00Z`)) / DAY_MS),
      ),
      conversion_policy: "selected_btc_usd_calendar",
      ...evidence(btcMarket),
    });

  const jpyMarket = market.get(`${day}:JPY`);
  const fx = jpyMarket ? ecbCross(day) : null;
  if (jpyMarket && fx)
    paths.push({
      path_class: "PEPECASH→JPY→USD",
      usd: Number(jpyMarket.price) * fx.usdPerJpy,
      depth: 2,
      market_day: day,
      market_source: "zaif",
      conversion_source: "ecb",
      conversion_observed_day: fx.observedDay,
      conversion_age_days: fx.age,
      conversion_policy: "official_reference_cross",
      ...evidence(jpyMarket),
    });

  return { day, paths };
});

const manifestSummary = Object.fromEntries(
  ["pepecash_btc", "pepecash_jpy"].map((dataset) => {
    const files = manifests.filter((row) => row.dataset === dataset);
    const canonical = files.map((row) => `${row.source_url}\t${row.sha256}\t${row.rows}`).join("\n");
    return [
      dataset,
      {
        files: files.length,
        executions: files.reduce((sum, row) => sum + Number(row.rows), 0),
        manifest_sha256: createHash("sha256").update(canonical).digest("hex"),
        first_url: files[0]?.source_url ?? null,
        last_url: files.at(-1)?.source_url ?? null,
      },
    ];
  }),
);

const count = (predicate) => candidates.filter(predicate).length;
const report = {
  schema: "pepecash-usd-candidates/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  policy: {
    admitted_path_classes: ["PEPECASH→JPY→USD", "PEPECASH→BTC→USD"],
    market_price_carry_days: 0,
    ecb_max_age_days: 4,
    maximum_depth: 2,
    cycles_allowed: false,
    claim: "offline candidates only; not selected prices or fair value",
  },
  inputs: { zaif_manifests: manifestSummary },
  summary: {
    market_days: candidates.length,
    first_day: candidates[0]?.day ?? null,
    last_day: candidates.at(-1)?.day ?? null,
    btc_path_days: count((row) => row.paths.some((path) => path.path_class === "PEPECASH→BTC→USD")),
    jpy_path_days: count((row) => row.paths.some((path) => path.path_class === "PEPECASH→JPY→USD")),
    both_path_days: count((row) => row.paths.length === 2),
    neither_path_days: count((row) => row.paths.length === 0),
    carried_ecb_days: count((row) =>
      row.paths.some((path) => path.path_class.includes("JPY") && path.conversion_age_days > 0),
    ),
  },
  days: candidates,
};

if (output) {
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ output, ...report.summary, inputs: report.inputs }, null, 2)}\n`);
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
