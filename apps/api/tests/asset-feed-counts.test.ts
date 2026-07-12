import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ASSET_FEED_COUNT_SOURCES, FEED_COUNT_COLUMNS, feedCountResetSql, feedCountWriteSql,
} from "../src/indexer/asset-feed-counts";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trades (asset TEXT);
    CREATE TABLE issuances (asset TEXT);
    CREATE TABLE dispensers (asset TEXT);
    CREATE TABLE dispenses (asset TEXT);
    CREATE TABLE orders (give_asset TEXT, get_asset TEXT);
    CREATE TABLE sends (asset TEXT);
    CREATE TABLE fairmints (asset TEXT);
    CREATE TABLE dividends (asset TEXT, dividend_asset TEXT);
    CREATE TABLE destructions (asset TEXT);
    CREATE TABLE pools (asset_a TEXT, asset_b TEXT, lp_asset TEXT);
    CREATE TABLE assets (asset TEXT PRIMARY KEY);
    CREATE TABLE asset_feed_counts (
      asset TEXT PRIMARY KEY,
      sales INTEGER NOT NULL DEFAULT 0, issuances INTEGER NOT NULL DEFAULT 0,
      dispensers INTEGER NOT NULL DEFAULT 0, dispenses INTEGER NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0,
      fairmints INTEGER NOT NULL DEFAULT 0, dividends INTEGER NOT NULL DEFAULT 0,
      destructions INTEGER NOT NULL DEFAULT 0, pools INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO assets VALUES ('RARE'),('OTHER'),('XCP');
    INSERT INTO asset_feed_counts (asset) SELECT asset FROM assets;

    INSERT INTO trades VALUES ('RARE'),('RARE'),('OTHER');
    INSERT INTO issuances VALUES ('RARE'),('RARE'),('OTHER');
    INSERT INTO dispensers VALUES ('RARE'),('OTHER');
    INSERT INTO dispenses VALUES ('RARE'),('RARE'),('OTHER');
    INSERT INTO orders VALUES
      ('RARE','XCP'),
      ('XCP','RARE'),
      ('RARE','RARE'),
      ('OTHER','XCP');
    INSERT INTO sends VALUES ('RARE'),('RARE'),('RARE'),('OTHER');
    INSERT INTO fairmints VALUES ('RARE'),('OTHER');
    INSERT INTO dividends VALUES
      ('RARE','XCP'),
      ('XCP','RARE'),
      ('RARE','RARE'),
      ('OTHER','XCP');
    INSERT INTO destructions VALUES ('RARE'),('RARE'),('OTHER');
    INSERT INTO pools VALUES
      ('RARE','XCP','RARE-XCP'),
      ('XCP','RARE','RARE-XCP-2'),
      ('RARE','RARE','RARE'),
      ('OTHER','XCP','OTHER-XCP');
  `);
  return db;
}

test("full and dirty-scoped builders converge, including a reorg to zero", () => {
  const db = fixture();
  for (const column of FEED_COUNT_COLUMNS) {
    const source = ASSET_FEED_COUNT_SOURCES[column];
    db.exec(feedCountWriteSql(column, source.sql));
  }
  let rare = db.prepare("SELECT * FROM asset_feed_counts WHERE asset='RARE'").get() as Record<string, number>;
  assert.equal(rare.orders, 3);
  assert.equal(rare.sends, 3);
  assert.equal(rare.pools, 3);

  db.exec("DELETE FROM sends WHERE asset='RARE'");
  db.prepare(feedCountResetSql("?")).run("RARE");
  for (const column of FEED_COUNT_COLUMNS) {
    const source = ASSET_FEED_COUNT_SOURCES[column];
    db.prepare(feedCountWriteSql(column, source.sql, "AND asset IN (?)")).run("RARE");
  }
  rare = db.prepare("SELECT * FROM asset_feed_counts WHERE asset='RARE'").get() as Record<string, number>;
  assert.equal(rare.sends, 0, "scoped reset clears a count whose last source row disappeared");
  assert.equal(rare.orders, 3);
  assert.equal(rare.pools, 3);
  const other = db.prepare("SELECT sends FROM asset_feed_counts WHERE asset='OTHER'").get() as { sends: number };
  assert.equal(other.sends, 1, "scoped rebuild leaves clean assets untouched");
});

test("materialized feed projections exactly match one logical record per asset", () => {
  const db = fixture();
  const expected: Record<string, number> = {
    sales: 2,
    issuances: 2,
    dispensers: 1,
    dispenses: 2,
    orders: 3,
    sends: 3,
    fairmints: 1,
    dividends: 3,
    destructions: 2,
    pools: 3,
  };
  for (const [column, source] of Object.entries(ASSET_FEED_COUNT_SOURCES)) {
    const row = db.prepare(`SELECT COUNT(*) n FROM (${source.sql}) WHERE asset='RARE'`).get() as { n: number };
    assert.equal(row.n, expected[column], column);
  }
});

test("same-asset multi-leg records count once, distinct legs each count once", () => {
  const db = fixture();
  const count = (column: "orders" | "dividends" | "pools", asset: string) => {
    const source = ASSET_FEED_COUNT_SOURCES[column];
    return (db.prepare(`SELECT COUNT(*) n FROM (${source.sql}) WHERE asset=?`).get(asset) as { n: number }).n;
  };
  assert.equal(count("orders", "RARE"), 3);
  assert.equal(count("dividends", "RARE"), 3);
  assert.equal(count("pools", "RARE"), 3);
  assert.equal(count("pools", "XCP"), 3);
});
