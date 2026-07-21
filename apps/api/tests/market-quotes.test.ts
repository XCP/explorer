import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCmcLatestQuote } from "#api/integrations/coinmarketcap";
import { parseZaifTrades, zaifDailyVwm } from "#api/integrations/zaif";

test("CMC latest-quote parsing accepts a valid USD quote and rejects drift", () => {
  const quote = parseCmcLatestQuote({
    data: {
      "132": { quote: { USD: { price: 1.5012, volume_24h: 84210.5, last_updated: "2026-07-21T04:10:00.000Z" } } },
    },
  });
  assert.deepEqual(quote, { priceUsd: 1.5012, volume24hUsd: 84210.5, lastUpdated: "2026-07-21T04:10:00.000Z" });
  assert.throws(() => parseCmcLatestQuote({ data: {} }), /price is invalid/);
  assert.throws(
    () => parseCmcLatestQuote({ data: { "132": { quote: { USD: { price: 0, last_updated: "x" } } } } }),
    /price is invalid/,
  );
  assert.throws(
    () => parseCmcLatestQuote({ data: { "132": { quote: { USD: { price: 1.5 } } } } }),
    /timestamp is missing/,
  );
});

test("Zaif trade parsing validates every consumed field", () => {
  const trades = parseZaifTrades([
    { date: 1784605075, price: 202.5612, amount: 1.4, tid: 26251570, currency_pair: "xcp_jpy", trade_type: "ask" },
  ]);
  assert.deepEqual(trades, [{ date: 1784605075, price: 202.5612, amount: 1.4, tid: 26251570 }]);
  assert.throws(() => parseZaifTrades({ not: "array" }), /must be an array/);
  assert.throws(() => parseZaifTrades([{ date: 1, price: 0, amount: 1, tid: 1 }]), /price/);
  assert.throws(() => parseZaifTrades([{ date: 1, price: 1, amount: -2, tid: 1 }]), /amount/);
});

test("Zaif daily VWM groups by UTC day and weights the median by volume", () => {
  // Day one: 10 XCP at ¥100 and 1 XCP at ¥300 — the volume-weighted median sits at ¥100.
  // Day two spans a UTC midnight from day one's trades and must bucket separately.
  const day1 = Math.floor(Date.parse("2026-07-20T10:00:00Z") / 1000);
  const day2 = Math.floor(Date.parse("2026-07-21T00:05:00Z") / 1000);
  const rows = zaifDailyVwm([
    { date: day1, price: 300, amount: 1, tid: 3 },
    { date: day1 + 60, price: 100, amount: 10, tid: 4 },
    { date: day2, price: 200, amount: 2, tid: 5 },
  ]);
  assert.deepEqual(
    rows.map((row) => ({ day: row.day, price: row.price, volume: row.volume, trades: row.trades })),
    [
      { day: "2026-07-20", price: 100, volume: 11, trades: 2 },
      { day: "2026-07-21", price: 200, volume: 2, trades: 1 },
    ],
  );
});
