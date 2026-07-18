#!/usr/bin/env node

/** Reproducible, read-only inventory of attributable CEX history for canonical Counterparty assets. */
const KAIKO_ROOT = "https://reference-data-api.kaiko.io/v1/instruments";

const IDENTITIES = new Map([
  ["polo:BTC_XCP", "XCP"], ["polo:BTC_FLDC", "FLDC"], ["polo:BTC_SJCX", "SJCX"],
  ["polo:BTC_BCY", "BITCRYSTALS"], ["polo:BTC_LTBC", "LTBCOIN"],
  ["btrx:BTC-SJCX", "SJCX"], ["btrx:BTC-BCY", "BITCRYSTALS"], ["btrx:BTC-GEMZ", "GEMZ"],
  ["btrx:BTC-TRIG", "TRIGGERS"], ["btrx:BTC-SCOT", "SCOTCOIN"],
  ["zaif:xcp_btc", "XCP"], ["zaif:xcp_jpy", "XCP"],
  ["zaif:sjcx_btc", "SJCX"], ["zaif:sjcx_jpy", "SJCX"],
  ["zaif:bitcrystals_btc", "BITCRYSTALS"], ["zaif:bitcrystals_jpy", "BITCRYSTALS"],
  ["zaif:pepecash_btc", "PEPECASH"], ["zaif:pepecash_jpy", "PEPECASH"],
  ["zaif:zaif_btc", "ZAIF"], ["zaif:zaif_jpy", "ZAIF"],
  ["zaif:cicc_btc", "CICC"], ["zaif:cicc_jpy", "CICC"],
]);

async function exchangeInstruments(exchange) {
  const response = await fetch(`${KAIKO_ROOT}?exchange_code=${exchange}&page_size=1000`, {
    headers: { accept: "application/json", "user-agent": "xcp.io-market-audit" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Kaiko ${exchange} catalog failed: ${response.status}`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.data)) throw new Error(`Kaiko ${exchange} catalog shape changed`);
  return payload.data;
}

const exchanges = ["polo", "btrx", "zaif"];
const catalogs = await Promise.all(exchanges.map(async (exchange) => [exchange, await exchangeInstruments(exchange)]));
const markets = [];
for (const [exchange, instruments] of catalogs) {
  for (const instrument of instruments) {
    const key = `${exchange}:${instrument.exchange_pair_code}`;
    const asset = IDENTITIES.get(key);
    if (!asset) continue;
    markets.push({
      asset,
      exchange,
      pair: instrument.exchange_pair_code,
      base: instrument.base_asset,
      quote: instrument.quote_asset,
      first_trade: instrument.trade_start_time,
      last_trade: instrument.trade_end_time,
      trades: instrument.trade_count,
    });
  }
}

const found = new Set(markets.map((market) => `${market.exchange}:${market.pair}`));
const missing = [...IDENTITIES.entries()]
  .filter(([key]) => !found.has(key))
  .map(([market, asset]) => ({ asset, market }));
console.log(JSON.stringify({ provider: "kaiko", markets, missing }, null, 2));
