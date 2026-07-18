import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDexTradeXcpBtc } from "#api/integrations/dex-trade";

test("Dex-Trade XCP/BTC parser requires a positive ticker backed by a recent trade", () => {
  const now = 2_000_000_000;
  assert.equal(
    parseDexTradeXcpBtc({ status: true, data: { last: "0.000023" } }, { status: true, data: [{ timestamp: now - 60 }] }, now),
    0.000023,
  );
  assert.throws(
    () => parseDexTradeXcpBtc({ status: true, data: { last: "0.000023" } }, { status: true, data: [{ timestamp: now - 8 * 86_400 }] }, now),
    /stale/,
  );
  assert.throws(
    () => parseDexTradeXcpBtc({ status: true, data: { last: "0" } }, { status: true, data: [{ timestamp: now - 60 }] }, now),
    /invalid/,
  );
});
