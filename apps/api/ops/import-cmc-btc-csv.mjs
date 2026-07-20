#!/usr/bin/env node

/** Import the official CMC Bitcoin website download only before the primary Coinbase calendar. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { parseCmcHistoricalCsv } from "./lib/cmc-market-data.mjs";

const path = process.env.CMC_CSV_PATH;
if (!path) throw new Error("CMC_CSV_PATH is required");
const primaryWindowStart = "2015-07-20";
const raw = readFileSync(resolve(path), "utf8");
const allRows = parseCmcHistoricalCsv(raw);
const rows = allRows.filter((row) => row.day < primaryWindowStart);
if (!rows.length) throw new Error("CMC BTC CSV has no observations before the Coinbase window");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
let written = 0;
for (let offset = 0; offset < rows.length; offset += 75) {
  const values = rows
    .slice(offset, offset + 75)
    .map(
      (row) => `(${quote(row.day)},'BTC','USD','coinmarketcap','aggregate',${row.close},0,0,'aggregate_daily_close')`,
    )
    .join(",");
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
const sourceUrl = "https://coinmarketcap.com/currencies/bitcoin/historical-data/";
executeRemoteD1(`INSERT INTO market_price_imports(source,venue,dataset,source_url,sha256,fetched_at,rows)
  VALUES('coinmarketcap','aggregate','btc_usd_daily_download_pre_coinbase',${quote(sourceUrl)},${quote(sha256)},${Math.floor(Date.now() / 1_000)},${rows.length})
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
    primary_window_start: primaryWindowStart,
    sha256,
  }),
);
