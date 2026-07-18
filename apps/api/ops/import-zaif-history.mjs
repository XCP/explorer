#!/usr/bin/env node

/** Authorized, convergent import of Zaif daily market observations and source-file checksums. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { fetchZaifHistory } from "./lib/zaif-market-data.mjs";

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const chunks = (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

const MARKETS = [
  ["xcp_btc", "XCP", "BTC"], ["xcp_jpy", "XCP", "JPY"],
  ["pepecash_btc", "PEPECASH", "BTC"], ["pepecash_jpy", "PEPECASH", "JPY"],
  ["sjcx_btc", "SJCX", "BTC"], ["sjcx_jpy", "SJCX", "JPY"],
  ["bitcrystals_btc", "BCY", "BTC"], ["bitcrystals_jpy", "BCY", "JPY"],
  ["zaif_btc", "ZAIF", "BTC"], ["zaif_jpy", "ZAIF", "JPY"],
  ["cicc_btc", "CICC", "BTC"], ["cicc_jpy", "CICC", "JPY"],
];
const requested = new Set((process.env.ZAIF_MARKETS ?? "").split(",").map((pair) => pair.trim()).filter(Boolean));
const selectedMarkets = requested.size ? MARKETS.filter(([pair]) => requested.has(pair)) : MARKETS;
if (!selectedMarkets.length || selectedMarkets.length !== (requested.size || selectedMarkets.length)) {
  throw new Error("ZAIF_MARKETS contains an unknown or duplicate market");
}
const histories = [];
for (const [pair, baseCurrency, quoteCurrency] of selectedMarkets) {
  histories.push({ ...(await fetchZaifHistory(pair)), baseCurrency, quoteCurrency });
}
let observationsWritten = 0;
let manifestsWritten = 0;

for (const history of histories) {
  const { baseCurrency, quoteCurrency } = history;
  for (const batch of chunks(history.daily, 50)) {
    const values = batch.map((row) => `(${[
      quote(row.day), quote(baseCurrency), quote(quoteCurrency), quote("zaif"), quote("cex"), row.price,
      row.volumeBase, row.trades, row.firstTime, row.lastTime, quote("volume_weighted_median"),
    ].join(",")})`).join(",");
    const result = executeRemoteD1(`INSERT INTO market_price_observations(
      day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method
    ) VALUES ${values}
    ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
      price=excluded.price,volume_base=excluded.volume_base,trades=excluded.trades,
      first_time=excluded.first_time,last_time=excluded.last_time,method=excluded.method
    WHERE market_price_observations.price IS NOT excluded.price
      OR market_price_observations.volume_base IS NOT excluded.volume_base
      OR market_price_observations.trades IS NOT excluded.trades
      OR market_price_observations.first_time IS NOT excluded.first_time
      OR market_price_observations.last_time IS NOT excluded.last_time
      OR market_price_observations.method IS NOT excluded.method`);
    observationsWritten += Number(result.meta.changes ?? result.meta.rows_written ?? 0);
  }

  for (const batch of chunks(history.manifests, 40)) {
    const values = batch.map((row) => `(${[
      quote("zaif"), quote("cex"), quote(history.pair), quote(row.url), quote(row.sha256),
      history.fetchedAt, row.rows,
    ].join(",")})`).join(",");
    const result = executeRemoteD1(`INSERT INTO market_price_imports(
      source,venue,dataset,source_url,sha256,fetched_at,rows
    ) VALUES ${values}
    ON CONFLICT(source,dataset,source_url) DO UPDATE SET
      venue=excluded.venue,sha256=excluded.sha256,fetched_at=excluded.fetched_at,rows=excluded.rows
    WHERE market_price_imports.venue IS NOT excluded.venue
      OR market_price_imports.sha256 IS NOT excluded.sha256
      OR market_price_imports.rows IS NOT excluded.rows`);
    manifestsWritten += Number(result.meta.changes ?? result.meta.rows_written ?? 0);
  }
}

const summary = executeRemoteD1(`SELECT source,venue,base_currency,quote_currency,COUNT(*) days,
  SUM(trades) executions,MIN(day) first_day,MAX(day) last_day
FROM market_price_observations GROUP BY source,venue,base_currency,quote_currency
ORDER BY source,venue,base_currency,quote_currency`).rows;
console.log(JSON.stringify({ observations_written: observationsWritten, manifests_written: manifestsWritten, summary }, null, 2));
