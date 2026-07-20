#!/usr/bin/env node

/** Import the official CMC website download before the more precise Builder API window. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { parseCmcHistoricalCsv } from "./lib/cmc-market-data.mjs";

const path = process.env.CMC_CSV_PATH;
if (!path) throw new Error("CMC_CSV_PATH is required");
const apiWindowStart = process.env.CMC_API_WINDOW_START ?? "2023-07-19";
if (!/^\d{4}-\d{2}-\d{2}$/.test(apiWindowStart)) throw new Error("CMC_API_WINDOW_START must be YYYY-MM-DD");

const raw = readFileSync(resolve(path), "utf8");
const allRows = parseCmcHistoricalCsv(raw);
const rows = allRows.filter((row) => row.day < apiWindowStart);
if (!rows.length) throw new Error("CMC CSV has no observations before the API window");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
let written = 0;
for (let offset = 0; offset < rows.length; offset += 75) {
  const values = rows
    .slice(offset, offset + 75)
    .map(
      (row) =>
        `(${quote(row.day)},'XCP','USD','coinmarketcap','aggregate',${row.close},0,0,'aggregate_daily_close',${row.volumeUsd},${row.marketCapUsd})`,
    )
    .join(",");
  const result = executeRemoteD1(`INSERT INTO market_price_observations(
    day,base_currency,quote_currency,source,venue,price,volume_base,trades,method,
    reported_volume_quote,reported_market_cap_quote
  ) VALUES ${values}
  ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET price=excluded.price,method=excluded.method,
    reported_volume_quote=excluded.reported_volume_quote,
    reported_market_cap_quote=excluded.reported_market_cap_quote
  WHERE market_price_observations.price IS NOT excluded.price
    OR market_price_observations.method IS NOT excluded.method
    OR market_price_observations.reported_volume_quote IS NOT excluded.reported_volume_quote
    OR market_price_observations.reported_market_cap_quote IS NOT excluded.reported_market_cap_quote`);
  written += Number(result.meta.changes ?? result.meta.rows_written ?? 0);
}

const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sourceUrl = "https://coinmarketcap.com/currencies/counterparty/historical-data/";
executeRemoteD1(`INSERT INTO market_price_imports(source,venue,dataset,source_url,sha256,fetched_at,rows)
  VALUES('coinmarketcap','aggregate','xcp_usd_daily_download_pre_api',${quote(sourceUrl)},${quote(sha256)},${Math.floor(Date.now() / 1_000)},${rows.length})
  ON CONFLICT(source,dataset,source_url) DO UPDATE SET venue=excluded.venue,sha256=excluded.sha256,
    fetched_at=excluded.fetched_at,rows=excluded.rows
  WHERE market_price_imports.venue IS NOT excluded.venue
    OR market_price_imports.sha256 IS NOT excluded.sha256
    OR market_price_imports.rows IS NOT excluded.rows`);

console.log(
  JSON.stringify({
    source: "coinmarketcap",
    written,
    csv_rows: allRows.length,
    imported_rows: rows.length,
    first: rows[0].day,
    last: rows.at(-1).day,
    api_window_start: apiWindowStart,
    sha256,
  }),
);
