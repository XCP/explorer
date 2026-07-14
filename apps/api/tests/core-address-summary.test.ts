import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { addressSummary } from "#api/queries/addresses";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact address summary derives identity counts without scanning string keys", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE balances(address_id INTEGER,asset_id INTEGER,quantity_normalized TEXT);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,issuer_id INTEGER);
    CREATE TABLE dispensers(tx_index INTEGER PRIMARY KEY,source_id INTEGER,status INTEGER);
    CREATE TABLE orders(tx_index INTEGER PRIMARY KEY,source_id INTEGER,status TEXT);
    CREATE TABLE address_signals(
      address_id INTEGER PRIMARY KEY,assets_held INTEGER,first_block INTEGER,last_block INTEGER,disp_trust REAL
    );
    INSERT INTO address_dictionary VALUES(1,'holder');
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'CARD'),(3,'OTHER');
    INSERT INTO balances VALUES(1,1,'12.50000000');
    INSERT INTO assets VALUES(2,1),(3,1);
    INSERT INTO dispensers VALUES(1,1,0),(2,1,10);
    INSERT INTO orders VALUES(1,1,'open'),(2,1,'filled');
    INSERT INTO address_signals VALUES(1,3,100,200,7.26);
  `);

  assert.deepEqual({ ...(await addressSummary(d1(db), "holder")) }, {
    xcp: "12.50000000",assets: 3,issued: 2,dispensers: 2,open_dispensers: 1,open_orders: 1,
    first_block: 100,last_block: 200,dispenser_trust: 7.3,
  });
  assert.deepEqual({ ...(await addressSummary(d1(db), "unknown")) }, {
    xcp: null,assets: 0,issued: 0,dispensers: 0,open_dispensers: 0,open_orders: 0,
    first_block: null,last_block: null,dispenser_trust: null,
  });
});
