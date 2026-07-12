import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { NETWORK_STATS_REBUILD_SQL } from "../src/indexer/network-stats";

test("network stats snapshot matches exact source counts and totals", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE assets (asset TEXT); CREATE TABLE transactions (fee TEXT); CREATE TABLE balances (quantity TEXT);
    CREATE TABLE sends (x INTEGER); CREATE TABLE dispensers (x INTEGER); CREATE TABLE dispenses (x INTEGER);
    CREATE TABLE orders (x INTEGER); CREATE TABLE order_matches (x INTEGER); CREATE TABLE broadcasts (x INTEGER);
    CREATE TABLE fairmints (x INTEGER); CREATE TABLE burns (earned TEXT); CREATE TABLE issuances (fee_paid TEXT, status TEXT);
    CREATE TABLE sweeps (fee_paid TEXT); CREATE TABLE dividends (fee_paid TEXT);
    CREATE TABLE destructions (asset TEXT, quantity TEXT, status TEXT);
    CREATE TABLE network_stats_snapshot (
      singleton INTEGER PRIMARY KEY, assets INTEGER DEFAULT 0, transactions INTEGER DEFAULT 0,
      balances INTEGER DEFAULT 0, sends INTEGER DEFAULT 0, issuances INTEGER DEFAULT 0,
      dispensers INTEGER DEFAULT 0, dispenses INTEGER DEFAULT 0, orders INTEGER DEFAULT 0,
      order_matches INTEGER DEFAULT 0, sweeps INTEGER DEFAULT 0, broadcasts INTEGER DEFAULT 0,
      dividends INTEGER DEFAULT 0, fairmints INTEGER DEFAULT 0, destructions INTEGER DEFAULT 0,
      holders INTEGER DEFAULT 0, btc_fees REAL DEFAULT 0, xcp_destroyed REAL DEFAULT 0,
      xcp_supply TEXT DEFAULT '0', updated_at INTEGER DEFAULT 0);
    INSERT INTO network_stats_snapshot (singleton) VALUES (1);
    INSERT INTO assets VALUES ('A'),('B'); INSERT INTO transactions VALUES ('100000000'),('50000000'),(NULL);
    INSERT INTO balances VALUES ('1'),('0'),('-1'),('20'); INSERT INTO sends VALUES (1),(2),(3);
    INSERT INTO burns VALUES ('500000000');
    INSERT INTO issuances VALUES ('10000000','valid'),('90000000','invalid'); INSERT INTO sweeps VALUES ('20000000');
    INSERT INTO dividends VALUES ('30000000');
    INSERT INTO destructions VALUES ('XCP','40000000','valid'),('OTHER','90000000','valid');
  `);
  db.exec(NETWORK_STATS_REBUILD_SQL);
  const row = db.prepare("SELECT * FROM network_stats_snapshot WHERE singleton=1").get() as Record<string, number>;
  assert.equal(row.assets, 2); assert.equal(row.transactions, 3); assert.equal(row.balances, 4);
  assert.equal(row.holders, 2); assert.equal(row.sends, 3); assert.equal(row.btc_fees, 1.5);
  assert.equal(row.xcp_destroyed, 1); assert.equal(row.xcp_supply, "400000000"); assert.ok(row.updated_at > 0);
});
