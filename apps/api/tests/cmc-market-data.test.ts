import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCmcXcpQuotes } from "#ops/lib/cmc-market-data";

test("CMC XCP quotes preserve exact identity and daily aggregate prices", () => {
  assert.deepEqual(parseCmcXcpQuotes({
    data: { id: 132, symbol: "XCP", quotes: [
      { timestamp: "2026-07-17T00:00:00.000Z", quote: { USD: { price: 1.25 } } },
      { timestamp: "2026-07-18T00:00:00.000Z", quote: { USD: { price: "1.20" } } },
    ] },
  }), [
    { day: "2026-07-17", price: 1.25 },
    { day: "2026-07-18", price: 1.2 },
  ]);
});

test("CMC XCP quotes reject ticker collisions and duplicate days", () => {
  assert.throws(() => parseCmcXcpQuotes({ data: { id: 1405, symbol: "PEPECASH", quotes: [] } }), /shape/);
  assert.throws(() => parseCmcXcpQuotes({ data: { id: 132, symbol: "XCP", quotes: [
    { timestamp: "2026-07-18T00:00:00Z", quote: { USD: { price: 1 } } },
    { timestamp: "2026-07-18T12:00:00Z", quote: { USD: { price: 2 } } },
  ] } }), /duplicate/);
});
