#!/usr/bin/env node

/** Import the CMC Builder daily XCP quote window as aggregate observations, never as venue executions. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { parseCmcXcpQuotes } from "./lib/cmc-market-data.mjs";

const key = process.env.CMC_API_KEY;
if (!key) throw new Error("CMC_API_KEY is required");

const START = process.env.CMC_START ?? "2023-07-18";
const END = process.env.CMC_END ?? new Date().toISOString().slice(0, 10);
const sourceUrl = new URL("https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/historical");
sourceUrl.search = new URLSearchParams({
  id: "132", time_start: START, time_end: END, interval: "1d", convert: "USD", count: "1100",
}).toString();

const response = await fetch(sourceUrl, {
  headers: { accept: "application/json", "X-CMC_PRO_API_KEY": key },
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`CMC XCP history failed: ${response.status}`);
const raw = await response.text();
const payload = JSON.parse(raw);
const rows = parseCmcXcpQuotes(payload);

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
let written = 0;
for (let offset = 0; offset < rows.length; offset += 75) {
  const values = rows.slice(offset, offset + 75).map((row) =>
    `(${quote(row.day)},'XCP','USD','coinmarketcap','aggregate',${row.price},0,0,'aggregate_daily_quote')`,
  ).join(",");
  const result = executeRemoteD1(`INSERT INTO market_price_observations(
    day,base_currency,quote_currency,source,venue,price,volume_base,trades,method
  ) VALUES ${values}
  ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET price=excluded.price,method=excluded.method
  WHERE market_price_observations.price IS NOT excluded.price
    OR market_price_observations.method IS NOT excluded.method`);
  written += Number(result.meta.changes ?? result.meta.rows_written ?? 0);
}

const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const fetchedAt = Math.floor(Date.now() / 1_000);
executeRemoteD1(`INSERT INTO market_price_imports(source,venue,dataset,source_url,sha256,fetched_at,rows)
  VALUES('coinmarketcap','aggregate','xcp_usd_daily',${quote(String(sourceUrl))},${quote(sha256)},${fetchedAt},${rows.length})
  ON CONFLICT(source,dataset,source_url) DO UPDATE SET venue=excluded.venue,sha256=excluded.sha256,
    fetched_at=excluded.fetched_at,rows=excluded.rows
  WHERE market_price_imports.venue IS NOT excluded.venue
    OR market_price_imports.sha256 IS NOT excluded.sha256
    OR market_price_imports.rows IS NOT excluded.rows`);

console.log(JSON.stringify({ source: "coinmarketcap", written, rows: rows.length, first: rows[0].day, last: rows.at(-1).day }));
