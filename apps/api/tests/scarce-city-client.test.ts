import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { parseScarceCitySales } from "#api/integrations/scarce-city";
import { nextScarceCursor, SCARCE_SALE_UPSERT_SQL } from "#api/indexer/scarce-sales";

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
  const rows = [{ asset_id: 10 }, { asset_id: 20 }, { asset_id: 30 }];
  assert.equal(nextScarceCursor(rows, null), 30);
  assert.equal(nextScarceCursor(rows, 20), 19);
  assert.equal(nextScarceCursor(rows, 10), 9);
});

test("Scarce City sales resolve compact asset identity and converge on replay", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE scarce_city_sales(asset_id INTEGER,sold_at INTEGER,price_btc REAL,
      PRIMARY KEY(asset_id,sold_at));
    INSERT INTO asset_dictionary VALUES(7,'RAREPEPE');
  `);
  db.prepare(SCARCE_SALE_UPSERT_SQL).run(123, 0.1, "RAREPEPE");
  db.prepare(SCARCE_SALE_UPSERT_SQL).run(123, 0.2, "RAREPEPE");
  assert.deepEqual(
    { ...db.prepare(`SELECT asset_id,sold_at,price_btc FROM scarce_city_sales`).get() },
    { asset_id: 7, sold_at: 123, price_btc: 0.2 },
  );
  db.close();
});
