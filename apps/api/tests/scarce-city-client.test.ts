import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScarceCitySales } from "#api/integrations/scarce-city";
import { nextScarceCursor } from "#api/indexer/scarce-sales";

test("Scarce City parsing accepts the consumed sale fields", () => {
  const sales = [{ assetName: "RAREPEPE", priceInBtc: "0.1", timestamp: "Sun, 12 Jul 2026 12:00:00 GMT" }];
  assert.deepEqual(parseScarceCitySales(sales), sales);
});

test("Scarce City parsing rejects provider drift", () => {
  assert.throws(() => parseScarceCitySales({ sales: [] }), /must be an array/);
  assert.throws(() => parseScarceCitySales([{ priceInBtc: null }]), /string or number/);
  assert.throws(() => parseScarceCitySales([{ priceInBtc: Number.NaN }]), /must be finite/);
  assert.throws(() => parseScarceCitySales([{ timestamp: 1 }]), /timestamp must be a string/);
});

test("Scarce City cursor stops immediately before the first transient failure", () => {
  const rows = [{ rowid: 10 }, { rowid: 20 }, { rowid: 30 }];
  assert.equal(nextScarceCursor(rows, null), 30);
  assert.equal(nextScarceCursor(rows, 20), 19);
  assert.equal(nextScarceCursor(rows, 10), 9);
});
