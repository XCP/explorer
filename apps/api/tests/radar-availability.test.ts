import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { radarAvailable } from "#api/queries/radar";

test("availability ignores retained Ethereum asks and keeps stocked dispenser unit prices", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE prices(currency TEXT,day TEXT,usd REAL);
    INSERT INTO prices VALUES('BTC','2026-11-02',100000);
    CREATE TABLE dispensers(asset_id INTEGER,oracle_address_id INTEGER,satoshirate_normalized REAL,satoshirate INTEGER,give_quantity_normalized REAL,status INTEGER,give_remaining_normalized REAL);
    CREATE TABLE broadcasts(source_id INTEGER,value REAL,block_index INTEGER,tx_index INTEGER,status TEXT);
    CREATE TABLE assets(asset_id INTEGER,type TEXT,asset_longname TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER,asset TEXT);
    CREATE TABLE asset_signals(asset_id INTEGER,low_quality INTEGER,holders INTEGER,supply REAL,burned_pct REAL,avg_holder_dex REAL,pct_creator_holders REAL,holder_breadth REAL,max_realized_usd REAL,top1_pct REAL);
    CREATE TABLE core_state(key TEXT,value TEXT);
    INSERT INTO core_state VALUES('emblem_listings_generation','1');
    CREATE TABLE emblem_listings(asset_id INTEGER,price_usd REAL,marketplace TEXT,url TEXT,order_id TEXT,generation INTEGER,expiry INTEGER);
    INSERT INTO emblem_listings VALUES(1,1,'opensea','https://opensea.io/old','one',1,0),(2,1,'opensea','https://opensea.io/old','two',1,0);
    INSERT INTO assets VALUES(1,'named',NULL),(2,'named',NULL),(3,'named',NULL);
    INSERT INTO asset_dictionary VALUES(1,'ETHONLY'),(2,'BOTH'),(3,'EMPTY');
    INSERT INTO asset_signals SELECT asset_id,0,100,100,0,100000,100,10000,1000,0 FROM assets;
    INSERT INTO dispensers VALUES(2,NULL,0.002,200000,2,0,4),(3,NULL,0.001,100000,1,0,0);
  `);
  const d1 = {
    prepare: (sql: string) => ({ bind: () => ({ all: async () => ({ results: db.prepare(sql).all() }) }) }),
  } as unknown as D1Database;
  const rows = await radarAvailable(d1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].asset, "BOTH");
  assert.equal(rows[0].venue, "dispenser");
  assert.equal(rows[0].ask_btc, 0.001);
  assert.equal(rows[0].ask_usd, 100);
  assert.equal(rows[0].listing_url, null);
  assert.equal(rows[0].marketplace, null);
  db.close();
});
