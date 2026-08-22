import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { coreAssetFeedCounts } from "#api/queries/core-assets";

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

const d1 = (db: DatabaseSync) => ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

function fixture(projected: number | null): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,issuer_id INTEGER,owner_id INTEGER);
    CREATE INDEX idx_assets_issuer ON assets(issuer_id);
    CREATE INDEX idx_assets_owner ON assets(owner_id);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY,assets_controlled INTEGER);
    CREATE TABLE asset_feed_counts(
      asset_id INTEGER PRIMARY KEY,sales INTEGER,issuances INTEGER,dispensers INTEGER,dispenses INTEGER,
      orders INTEGER,sends INTEGER,fairmints INTEGER,dividends INTEGER,destructions INTEGER,pools INTEGER,
      subassets INTEGER
    );
    INSERT INTO address_dictionary VALUES(1,'issuer'),(2,'other');
    INSERT INTO asset_dictionary VALUES(10,'CARD'),(11,'OWNED'),(12,'OTHER');
    INSERT INTO assets VALUES(10,1,1),(11,2,1),(12,2,2);
    INSERT INTO address_signals VALUES(1,${projected === null ? "NULL" : projected});
    INSERT INTO asset_feed_counts VALUES(10,1,2,3,4,5,6,7,8,9,10,11);
  `);
  return db;
}

test("asset feed counts use the projected issuer and owner union", async () => {
  const result = await coreAssetFeedCounts(d1(fixture(2)), "CARD", "issuer");
  assert.equal(result?.from_issuer, 2);
});

test("asset feed counts fall back exactly while an address projection is unfilled", async () => {
  const result = await coreAssetFeedCounts(d1(fixture(null)), "CARD", "issuer");
  assert.equal(result?.from_issuer, 2);
});
