#!/usr/bin/env node

/** Import the checksummed historical-listings archive as non-venue CMC aggregate observations. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const input = process.env.CMC_SNAPSHOT_INPUT;
if (!input) throw new Error("CMC_SNAPSHOT_INPUT is required");
const dataset = process.env.CMC_DATASET ?? "counterparty_historical_listings";
if (!/^[a-z0-9_]+$/.test(dataset))
  throw new Error("CMC_DATASET must contain only lowercase letters, digits, or underscores");
const raw = readFileSync(resolve(input), "utf8");
const days = raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
if (!days.length || new Set(days.map((row) => row.day)).size !== days.length) {
  throw new Error("CMC snapshot archive is empty or contains duplicate days");
}
const observations = days.flatMap((row) =>
  (row.targets ?? []).map((target) => ({
    day: row.day,
    asset: target.asset,
    price: target.price_usd,
    volume: target.volume_24h_usd,
    marketCap: target.market_cap_usd,
  })),
);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const number = (value) => (value == null ? "NULL" : String(value));
let inserted = 0;
for (let offset = 0; offset < observations.length; offset += 60) {
  const values = observations
    .slice(offset, offset + 60)
    .map(
      (row) =>
        `(${quote(row.day)},${quote(row.asset)},'USD','coinmarketcap','aggregate',${row.price},0,0,'aggregate_historical_listing',${number(row.volume)},${number(row.marketCap)})`,
    )
    .join(",");
  const result = executeRemoteD1(`INSERT INTO market_price_observations(
    day,base_currency,quote_currency,source,venue,price,volume_base,trades,method,
    reported_volume_quote,reported_market_cap_quote) VALUES ${values}
    ON CONFLICT(day,base_currency,quote_currency,source,venue) DO NOTHING`);
  inserted += Number(result.meta.changes ?? result.meta.rows_written ?? 0);
}
const sha256 = createHash("sha256").update(raw).digest("hex");
const sourceUrl = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/historical";
executeRemoteD1(`INSERT INTO market_price_imports(source,venue,dataset,source_url,sha256,fetched_at,rows)
  VALUES('coinmarketcap','aggregate',${quote(dataset)},${quote(sourceUrl)},${quote(sha256)},
    ${Math.floor(Date.now() / 1_000)},${observations.length})
  ON CONFLICT(source,dataset,source_url) DO UPDATE SET venue=excluded.venue,sha256=excluded.sha256,
    fetched_at=excluded.fetched_at,rows=excluded.rows`);
console.log(JSON.stringify({ dataset, days: days.length, observations: observations.length, inserted, sha256 }));
