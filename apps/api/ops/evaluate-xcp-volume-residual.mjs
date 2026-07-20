#!/usr/bin/env node

/** Descriptive CMC reported-volume residual after exact named-venue notional reconstruction. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { fetchZaifHistory } from "./lib/zaif-market-data.mjs";

const DAY_MS = 86_400_000;
const opsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(opsDirectory, "../../..");
const diagnosticPath = resolve(
  process.env.DIAGNOSTIC_INPUT || `${repositoryRoot}/docs/data/xcp-price-disagreement-2026-07-18.json`,
);
const output = process.env.RESIDUAL_OUTPUT ? resolve(process.env.RESIDUAL_OUTPUT) : null;

const [zaifBtc, zaifJpy] = await Promise.all([fetchZaifHistory("xcp_btc"), fetchZaifHistory("xcp_jpy")]);
const cmcRows = executeRemoteD1(`SELECT day,reported_volume_quote volume_usd
  FROM market_price_observations WHERE source='coinmarketcap' AND venue='aggregate'
    AND base_currency='XCP' AND quote_currency='USD' AND reported_volume_quote IS NOT NULL ORDER BY day`).rows;
const btcRows = executeRemoteD1(`SELECT day,usd FROM prices WHERE currency='BTC' ORDER BY day`).rows;
const ecbRows = executeRemoteD1(`SELECT day,quote_currency,price FROM market_price_observations
  WHERE source='ecb' AND venue='reference' AND base_currency='EUR'
    AND quote_currency IN ('JPY','USD') ORDER BY day`).rows;
const dexRows = executeRemoteD1(`SELECT date(match.block_time,'unixepoch') day,
  SUM(CASE WHEN forward.asset='BTC' THEN CAST(match.forward_quantity AS REAL)
           ELSE CAST(match.backward_quantity AS REAL) END)/1e8 btc_notional,
  COUNT(*) executions
  FROM order_matches match
  JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
  WHERE match.status='completed' AND match.block_time IS NOT NULL
    AND ((forward.asset='XCP' AND backward.asset='BTC') OR (forward.asset='BTC' AND backward.asset='XCP'))
  GROUP BY 1 ORDER BY 1`).rows;

const btcUsd = new Map(btcRows.map((row) => [row.day, Number(row.usd)]));
const ecb = new Map(ecbRows.map((row) => [`${row.day}:${row.quote_currency}`, Number(row.price)]));
const diagnostics = new Map(
  JSON.parse(readFileSync(diagnosticPath, "utf8")).days.map((row) => [row.day, row.disagreement.band]),
);

function dayOf(time) {
  return new Date(time * 1000).toISOString().slice(0, 10);
}

function priorDay(day, age) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - age * DAY_MS).toISOString().slice(0, 10);
}

function usdPerJpy(day) {
  for (let age = 0; age <= 4; age += 1) {
    const fxDay = priorDay(day, age);
    const usd = ecb.get(`${fxDay}:USD`);
    const jpy = ecb.get(`${fxDay}:JPY`);
    if (usd > 0 && jpy > 0) return { rate: usd / jpy, age };
  }
  return null;
}

function add(map, day, usd) {
  map.set(day, (map.get(day) ?? 0) + usd);
}

const zaifBtcUsd = new Map();
let zaifBtcUnconverted = 0;
for (const trade of zaifBtc.trades) {
  const day = dayOf(trade.time);
  const rate = btcUsd.get(day);
  if (rate > 0) add(zaifBtcUsd, day, trade.price * trade.amount * rate);
  else zaifBtcUnconverted += 1;
}

const zaifJpyUsd = new Map();
const zaifFxAge = new Map();
let zaifJpyUnconverted = 0;
for (const trade of zaifJpy.trades) {
  const day = dayOf(trade.time);
  const fx = usdPerJpy(day);
  if (fx) {
    add(zaifJpyUsd, day, trade.price * trade.amount * fx.rate);
    zaifFxAge.set(day, Math.max(zaifFxAge.get(day) ?? 0, fx.age));
  } else zaifJpyUnconverted += 1;
}

const dexUsd = new Map(
  dexRows.flatMap((row) => {
    const rate = btcUsd.get(row.day);
    return rate > 0 ? [[row.day, Number(row.btc_notional) * rate]] : [];
  }),
);

const days = cmcRows.map((row) => {
  const cmc = Number(row.volume_usd);
  const zaifBtcValue = zaifBtcUsd.get(row.day) ?? 0;
  const zaifJpyValue = zaifJpyUsd.get(row.day) ?? 0;
  const dex = dexUsd.get(row.day) ?? 0;
  const named = zaifBtcValue + zaifJpyValue + dex;
  const residual = cmc - named;
  const namedComponents = [zaifBtcValue, zaifJpyValue, dex].filter((value) => value > 0).length;
  return {
    day: row.day,
    cmc_reported_usd: cmc,
    zaif_xcp_btc_usd: zaifBtcValue,
    zaif_xcp_jpy_usd: zaifJpyValue,
    zaif_fx_age_days: zaifFxAge.get(row.day) ?? null,
    counterparty_dex_usd: dex,
    named_venue_usd: named,
    named_component_count: namedComponents,
    unattributed_reported_usd: residual,
    price_disagreement: diagnostics.get(row.day) ?? null,
    flags: [
      ...(residual < 0 ? ["negative_residual"] : []),
      ...(diagnostics.get(row.day) === "over_25_percent" ? ["severe_price_disagreement"] : []),
      ...(namedComponents === 0 ? ["no_named_venue_coverage"] : []),
      ...(namedComponents === 1 ? ["single_named_venue_component"] : []),
    ],
  };
});

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field]), 0);
}

function summary(rows) {
  return {
    days: rows.length,
    cmc_reported_usd: sum(rows, "cmc_reported_usd"),
    zaif_xcp_btc_usd: sum(rows, "zaif_xcp_btc_usd"),
    zaif_xcp_jpy_usd: sum(rows, "zaif_xcp_jpy_usd"),
    counterparty_dex_usd: sum(rows, "counterparty_dex_usd"),
    named_venue_usd: sum(rows, "named_venue_usd"),
    unattributed_reported_usd: sum(rows, "unattributed_reported_usd"),
    negative_residual_days: rows.filter((row) => row.unattributed_reported_usd < 0).length,
    named_coverage_days: rows.filter((row) => row.named_component_count > 0).length,
    no_named_coverage_days: rows.filter((row) => row.named_component_count === 0).length,
    severe_price_disagreement_days: rows.filter((row) => row.price_disagreement === "over_25_percent").length,
  };
}

const years = [...new Set(days.map((row) => row.day.slice(0, 4)))];
const report = {
  schema: "xcp-unattributed-reported-volume/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  claim: "Descriptive reported-volume residual; not reconstructed venue volume or price",
  methodology: {
    cmc: "official aggregate reported USD volume",
    zaif: "sum of exact first-party execution notionals converted by selected daily BTC/USD or official ECB JPY/USD",
    counterparty: "sum of exact completed XCP/BTC match notionals converted by selected daily BTC/USD",
    residual: "CMC - Zaif XCP/BTC - Zaif XCP/JPY - Counterparty DEX; negative values preserved",
    limitations: [
      "CMC constituent set unavailable",
      "daily conversion windows are asynchronous",
      "exchange-reported aggregate volume may be unreliable",
      "residual cannot identify any omitted venue",
    ],
  },
  conversion_failures: { zaif_btc_executions: zaifBtcUnconverted, zaif_jpy_executions: zaifJpyUnconverted },
  overall: summary(days),
  years: Object.fromEntries(years.map((year) => [year, summary(days.filter((row) => row.day.startsWith(year)))])),
  days,
};

if (output) {
  writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify(
      { output, conversion_failures: report.conversion_failures, overall: report.overall },
      null,
      2,
    )}\n`,
  );
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
