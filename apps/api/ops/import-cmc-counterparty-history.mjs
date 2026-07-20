#!/usr/bin/env node

/** Import an authorized CMC aggregate history for one identity-reviewed Counterparty asset. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const TARGETS = {
  BITCRYSTALS: { id: 1063, name: "BitCrystals", symbol: "BCY", slug: "bitcrystals" },
  SCOTCOIN: { id: 346, name: "Scotcoin", symbol: "SCOT", slug: "scotcoin" },
  LTBCOIN: { id: 550, name: "LTBcoin", symbol: "LTBC", slug: "ltbcoin" },
  GEMZ: { id: 779, name: "GetGems", symbol: "GEMZ", slug: "gems" },
  SWARM: { id: 607, name: "Swarm", symbol: "SWARM", slug: "swarm-old" },
  TILECOIN: { id: 694, name: "TileCoin", symbol: "XTC", slug: "tilecoin" },
  FLDC: { id: 606, name: "FoldingCoin", symbol: "FLDC", slug: "foldingcoin" },
  SJCX: { id: 549, name: "Storjcoin X", symbol: "SJCX", slug: "storjcoin-x" },
  PEPECASH: { id: 1405, name: "Pepe Cash", symbol: "PEPECASH", slug: "pepe-cash" },
  DATABITS: { id: 1603, name: "Databits", symbol: "DTB", slug: "databits" },
  TRIGGERS: { id: 1423, name: "Triggers", symbol: "TRIG", slug: "triggers" },
  ZAIF: { id: 1219, name: "ZAIF", symbol: "ZAIF", slug: "zaif" },
};

const key = process.env.CMC_API_KEY;
if (!key) throw new Error("CMC_API_KEY is required; website snapshot crawling is not authorized by CMC terms");
const asset = process.env.CMC_ASSET;
const target = TARGETS[asset];
if (!target) throw new Error(`CMC_ASSET must be one of: ${Object.keys(TARGETS).join(", ")}`);
const start = process.env.CMC_START;
const end = process.env.CMC_END;
if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? "")) {
  throw new Error("CMC_START and CMC_END must be YYYY-MM-DD");
}

const sourceUrl = new URL("https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/historical");
sourceUrl.search = new URLSearchParams({
  id: String(target.id),
  time_start: start,
  time_end: end,
  interval: "1d",
  convert: "USD",
  count: "10000",
}).toString();
const response = await fetch(sourceUrl, {
  headers: { accept: "application/json", "X-CMC_PRO_API_KEY": key },
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`CMC ${asset} history failed: ${response.status}`);
const raw = await response.text();
const payload = JSON.parse(raw);
if (
  payload?.data?.id !== target.id ||
  payload.data.name !== target.name ||
  payload.data.symbol !== target.symbol ||
  payload.data.slug !== target.slug ||
  !Array.isArray(payload.data.quotes)
) {
  throw new Error(`CMC ${asset} identity or response shape changed`);
}
const rows = payload.data.quotes.map((observation) => {
  const day = String(observation?.timestamp ?? "").slice(0, 10);
  const quote = observation?.quote?.USD;
  const price = Number(quote?.price);
  const volume = quote?.volume_24h;
  const marketCap = quote?.market_cap;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(price > 0)) throw new Error(`CMC ${asset} has an invalid quote`);
  if (
    (volume != null && (!Number.isFinite(Number(volume)) || Number(volume) < 0)) ||
    (marketCap != null && (!Number.isFinite(Number(marketCap)) || Number(marketCap) < 0))
  )
    throw new Error(`CMC ${asset} has an invalid aggregate`);
  return {
    day,
    price,
    volume: volume == null ? null : Number(volume),
    marketCap: marketCap == null ? null : Number(marketCap),
  };
});
if (!rows.length || new Set(rows.map((row) => row.day)).size !== rows.length) {
  throw new Error(`CMC ${asset} history is empty or contains duplicate days`);
}

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlNumber = (value) => (value == null ? "NULL" : String(value));
let written = 0;
for (let offset = 0; offset < rows.length; offset += 75) {
  const values = rows
    .slice(offset, offset + 75)
    .map(
      (row) =>
        `(${sqlQuote(row.day)},${sqlQuote(asset)},'USD','coinmarketcap','aggregate',${row.price},0,0,'aggregate_daily_quote',${sqlNumber(row.volume)},${sqlNumber(row.marketCap)})`,
    )
    .join(",");
  const result = executeRemoteD1(`INSERT INTO market_price_observations(
    day,base_currency,quote_currency,source,venue,price,volume_base,trades,method,
    reported_volume_quote,reported_market_cap_quote) VALUES ${values}
    ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET price=excluded.price,
      method=excluded.method,reported_volume_quote=excluded.reported_volume_quote,
      reported_market_cap_quote=excluded.reported_market_cap_quote
    WHERE market_price_observations.price IS NOT excluded.price
      OR market_price_observations.reported_volume_quote IS NOT excluded.reported_volume_quote
      OR market_price_observations.reported_market_cap_quote IS NOT excluded.reported_market_cap_quote`);
  written += Number(result.meta.changes ?? result.meta.rows_written ?? 0);
}

const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const dataset = `${asset.toLowerCase()}_usd_daily`;
executeRemoteD1(`INSERT INTO market_price_imports(source,venue,dataset,source_url,sha256,fetched_at,rows)
  VALUES('coinmarketcap','aggregate',${sqlQuote(dataset)},${sqlQuote(String(sourceUrl))},${sqlQuote(sha256)},
    ${Math.floor(Date.now() / 1_000)},${rows.length})
  ON CONFLICT(source,dataset,source_url) DO UPDATE SET venue=excluded.venue,sha256=excluded.sha256,
    fetched_at=excluded.fetched_at,rows=excluded.rows`);
console.log(
  JSON.stringify({
    asset,
    cmc_id: target.id,
    rows: rows.length,
    written,
    first: rows[0].day,
    last: rows.at(-1).day,
    sha256,
  }),
);
