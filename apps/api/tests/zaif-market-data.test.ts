import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateZaifDaily,
  parseZaifCsvIndex,
  parseZaifTimestamp,
  parseZaifTrades,
} from "#ops/lib/zaif-market-data";

test("Zaif CSV discovery keeps unique monthly files for the requested pair", () => {
  const html = `<a href="csv/2016/xcp_btc_2016_08.csv">August</a>
    <a href='csv/2016/xcp_btc_2016_08.csv'>duplicate</a>
    <a href="csv/2016/xcp_jpy_2016_08.csv">wrong pair</a>`;
  assert.deepEqual(parseZaifCsvIndex(html, "xcp_btc"), [
    "https://zaif.jp/more_data/xcp_btc/csv/2016/xcp_btc_2016_08.csv",
  ]);
});

test("Zaif timestamps are interpreted as JST rather than UTC", () => {
  const epoch = parseZaifTimestamp("2026-07-18 10:49:48.123456");
  assert.equal(new Date(epoch * 1_000).toISOString(), "2026-07-18T01:49:48.000Z");
  assert.equal(
    new Date(parseZaifTimestamp("2016-08-02 00:30:00") * 1_000).toISOString(),
    "2016-08-01T15:30:00.000Z",
  );
});

test("Zaif CSV parser accepts empty months and rejects invalid executions", () => {
  const header = "timestamp,price,amount,trade_type\n";
  assert.deepEqual(parseZaifTrades(header, "xcp_btc"), []);
  assert.throws(
    () => parseZaifTrades(`${header}2026-01-01 12:00:00,0,1,bid`, "xcp_btc"),
    /numeric row/,
  );
  assert.throws(
    () => parseZaifTrades(`${header}2026-01-01 12:00:00,1,1,unknown`, "xcp_btc"),
    /side row/,
  );
});

test("Zaif daily aggregation uses the volume-weighted median and UTC day", () => {
  const rows = parseZaifTrades(
    `timestamp,price,amount,trade_type
2026-01-02 08:30:00,1,4,bid
2026-01-02 09:30:00,2,5,ask
2026-01-02 10:30:00,100,1,bid`,
    "xcp_btc",
  );
  assert.deepEqual(aggregateZaifDaily(rows), [
    { day: "2026-01-01", price: 1, volumeXcp: 4, trades: 1, firstTime: 1767310200, lastTime: 1767310200 },
    { day: "2026-01-02", price: 2, volumeXcp: 6, trades: 2, firstTime: 1767313800, lastTime: 1767317400 },
  ]);
});
