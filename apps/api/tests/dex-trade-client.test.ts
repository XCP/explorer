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
    () => parseDexTradeMarket("XCPBTC", { status: true, data: { last: "0.000023" } }, { status: true, data: [{ timestamp: now - 8 * 86_400 }] }, now),
    /stale/,
  );
  assert.throws(
    () => parseDexTradeMarket("XCPBTC", { status: true, data: { last: "0" } }, { status: true, data: [{ timestamp: now - 60 }] }, now),
    /invalid/,
  );
});
