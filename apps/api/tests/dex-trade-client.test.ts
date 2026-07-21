import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDexTradeMarket } from "#api/integrations/dex-trade";

test("Dex-Trade XCP/BTC parser requires a positive ticker backed by a recent trade", () => {
  const now = 2_000_000_000;
  assert.deepEqual(
    parseDexTradeMarket(
      "XCPBTC",
      { status: true, data: { last: "0.000023" } },
      { status: true, data: [{ timestamp: now - 60, rate: "0.000022", volume: "4" }] },
      now,
    ),
    { pair: "XCPBTC", price: 0.000023, latestPrice: 0.000022, latestTime: now - 60, latestVolume: 4 },
  );
  assert.throws(
    () =>
      parseDexTradeMarket(
        "XCPBTC",
        { status: true, data: { last: "0.000023" } },
        { status: true, data: [{ timestamp: now - 8 * 86_400 }] },
        now,
      ),
    /stale/,
  );
  assert.throws(
    () =>
      parseDexTradeMarket(
        "XCPBTC",
        { status: true, data: { last: "0" } },
        { status: true, data: [{ timestamp: now - 60 }] },
        now,
      ),
    /invalid/,
  );
});

test("Dex-Trade candle history parses ascending and rejects provider drift", async () => {
  const { parseDexTradeHistory } = await import("#api/integrations/dex-trade");
  const rows = parseDexTradeHistory([
    { time: 1784000000, open: 2250, high: 2749, low: 2000, close: 2300, volume: 25300000000, pair: "XCPBTC" },
    { time: 1783000000, open: 2000, high: 2000, low: 1900, close: 1900, volume: 1000000000 },
  ]);
  assert.deepEqual(
    rows.map((row) => row.time),
    [1783000000, 1784000000],
  );
  assert.equal(rows[1]!.close, 2300);
  assert.throws(() => parseDexTradeHistory({ not: "an array" }), /must be an array/);
  assert.throws(() => parseDexTradeHistory([{ time: 1, open: 0, high: 2, low: 1, close: 1, volume: 0 }]), /open/);
  assert.throws(() => parseDexTradeHistory([{ time: 1, open: 1, high: 1, low: 2, close: 1, volume: 0 }]), /high below/);
  assert.throws(() => parseDexTradeHistory([{ time: "x", open: 1, high: 2, low: 1, close: 1, volume: 0 }]), /time/);
});
