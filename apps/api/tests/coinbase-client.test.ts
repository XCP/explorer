import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoinbaseCandles, parseCoinbaseTicker } from "#api/integrations/coinbase";

test("Coinbase candle parsing keeps only fields consumed by the price indexer", () => {
  assert.deepEqual(parseCoinbaseCandles([[1_700_000_000, 10, 20, 12, 18, 100]]), [{ time: 1_700_000_000, close: 18 }]);
});

test("Coinbase ticker parser accepts only a positive price", () => {
  assert.equal(parseCoinbaseTicker({ price: "64123.03" }), 64123.03);
  assert.throws(() => parseCoinbaseTicker({ price: "0" }), /invalid price/);
});

test("Coinbase candle parsing rejects provider drift", () => {
  assert.throws(() => parseCoinbaseCandles({ candles: [] }), /must be an array/);
  assert.throws(() => parseCoinbaseCandles([[1, 2]]), /invalid shape/);
  assert.throws(() => parseCoinbaseCandles([[1, 2, 3, 4, "5", 6]]), /invalid numeric fields/);
  assert.throws(() => parseCoinbaseCandles([[1, 2, 3, 4, Number.NaN, 6]]), /invalid numeric fields/);
});
