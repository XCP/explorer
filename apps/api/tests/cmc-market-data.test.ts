import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCmcHistoricalCsv, parseCmcXcpQuotes } from "#ops/lib/cmc-market-data";

test("CMC XCP quotes preserve exact identity and daily aggregate prices", () => {
  assert.deepEqual(
    parseCmcXcpQuotes({
      data: {
        id: 132,
        symbol: "XCP",
        quotes: [
          {
            timestamp: "2026-07-17T00:00:00.000Z",
            quote: {
              USD: {
                price: 1.25,
                volume_24h: 1000,
                market_cap: 5000,
              },
            },
          },
          { timestamp: "2026-07-18T00:00:00.000Z", quote: { USD: { price: "1.20" } } },
        ],
      },
    }),
    [
      { day: "2026-07-17", price: 1.25, volumeUsd: 1000, marketCapUsd: 5000 },
      { day: "2026-07-18", price: 1.2, volumeUsd: null, marketCapUsd: null },
    ],
  );
});

test("CMC XCP quotes reject ticker collisions and duplicate days", () => {
  assert.throws(() => parseCmcXcpQuotes({ data: { id: 1405, symbol: "PEPECASH", quotes: [] } }), /shape/);
  assert.throws(
    () =>
      parseCmcXcpQuotes({
        data: {
          id: 132,
          symbol: "XCP",
          quotes: [
            { timestamp: "2026-07-18T00:00:00Z", quote: { USD: { price: 1 } } },
            { timestamp: "2026-07-18T12:00:00Z", quote: { USD: { price: 2 } } },
          ],
        },
      }),
    /duplicate/,
  );
});

test("CMC XCP CSV preserves official OHLCV fields and normalizes dates", () => {
  const raw = `Date,Open*,High,Low,Close**,Volume,Market Cap\n17-Jul-26,$1.20 ,$1.30 ,$1.10 ,$1.25 ,"$30 ","$3,107,855 "\n9-Jul-26,$1.31 ,$1.31 ,$1.31 ,$1.31 ,$0 ,"$3,386,449 "`;
  assert.deepEqual(parseCmcHistoricalCsv(raw), [
    { day: "2026-07-09", open: 1.31, high: 1.31, low: 1.31, close: 1.31, volumeUsd: 0, marketCapUsd: 3386449 },
    { day: "2026-07-17", open: 1.2, high: 1.3, low: 1.1, close: 1.25, volumeUsd: 30, marketCapUsd: 3107855 },
  ]);
});

test("CMC XCP CSV rejects duplicate days and malformed OHLC", () => {
  const header = "Date,Open*,High,Low,Close**,Volume,Market Cap\n";
  const row = "17-Jul-26,$1.20,$1.30,$1.10,$1.25,$30,$3";
  assert.throws(() => parseCmcHistoricalCsv(`${header}${row}\n${row}`), /duplicate/);
  assert.throws(() => parseCmcHistoricalCsv(`${header}17-Jul-26,$1.20,$1.21,$1.10,$1.25,$30,$3`), /OHLC/);
});
