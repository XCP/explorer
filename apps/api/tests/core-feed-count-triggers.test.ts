import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const migration = readFileSync("migrations-core/0011_feed_count_triggers.sql", "utf8");

test("canonical inserts and rollback deletes maintain feed counts exactly once", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    INSERT INTO asset_dictionary VALUES(1,'A'),(2,'B'),(3,'LP');
    CREATE TABLE asset_feed_counts(
      asset_id INTEGER PRIMARY KEY,sales INTEGER DEFAULT 0,issuances INTEGER DEFAULT 0,
      dispensers INTEGER DEFAULT 0,dispenses INTEGER DEFAULT 0,orders INTEGER DEFAULT 0,
      sends INTEGER DEFAULT 0,fairmints INTEGER DEFAULT 0,dividends INTEGER DEFAULT 0,
      destructions INTEGER DEFAULT 0,pools INTEGER DEFAULT 0,subassets INTEGER DEFAULT 0,updated_at INTEGER);
    CREATE TABLE issuances(id INTEGER PRIMARY KEY,asset_id INTEGER);
    CREATE TABLE dispensers(id INTEGER PRIMARY KEY,asset_id INTEGER,status INTEGER);
    CREATE TABLE dispenses(id INTEGER PRIMARY KEY,asset_id INTEGER);
    CREATE TABLE sends(id INTEGER PRIMARY KEY,asset_id INTEGER);
    CREATE TABLE fairmints(id INTEGER PRIMARY KEY,asset_id INTEGER);
    CREATE TABLE destructions(id INTEGER PRIMARY KEY,asset_id INTEGER);
    CREATE TABLE trades(id INTEGER PRIMARY KEY,asset_id INTEGER);
    CREATE TABLE orders(id INTEGER PRIMARY KEY,give_asset_id INTEGER,get_asset_id INTEGER,status TEXT);
    CREATE TABLE dividends(id INTEGER PRIMARY KEY,asset_id INTEGER,dividend_asset_id INTEGER);
    CREATE TABLE pools(id INTEGER PRIMARY KEY,asset_a_id INTEGER,asset_b_id INTEGER,lp_asset TEXT);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,asset_longname TEXT);
  `);
  db.exec(migration);
  db.exec(`
    INSERT INTO sends VALUES(1,1);
    INSERT INTO orders VALUES(1,1,1,'open'),(2,1,2,'open');
    UPDATE orders SET status='filled' WHERE id=2;
    INSERT INTO dividends VALUES(1,1,1),(2,1,2);
    INSERT INTO pools VALUES(1,1,2,'LP');
    INSERT INTO trades VALUES(1,1);
    INSERT INTO assets VALUES(10,'A.ONE'),(11,'A.ONE.TWO');
  `);
  const count = (asset: number, column: string) =>
    (db.prepare(`SELECT ${column} value FROM asset_feed_counts WHERE asset_id=?`).get(asset) as { value: number })
      .value;
  assert.equal(count(1, "sends"), 1);
  assert.equal(count(1, "orders"), 2);
  assert.equal(count(2, "orders"), 1);
  assert.equal(count(1, "dividends"), 2);
  assert.equal(count(2, "dividends"), 1);
  assert.equal(count(1, "pools"), 1);
  assert.equal(count(2, "pools"), 1);
  assert.equal(count(3, "pools"), 1);
  assert.equal(count(1, "sales"), 1);
  assert.equal(count(1, "subassets"), 2);

  db.exec(`DELETE FROM orders WHERE id=2; DELETE FROM pools; DELETE FROM trades; DELETE FROM assets;`);
  assert.equal(count(1, "orders"), 1);
  assert.equal(count(2, "orders"), 0);
  assert.equal(count(1, "pools"), 0);
  assert.equal(count(2, "pools"), 0);
  assert.equal(count(3, "pools"), 0);
  assert.equal(count(1, "sales"), 0);
  assert.equal(count(1, "subassets"), 0);
});
