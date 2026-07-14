import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { CORE_NETWORK_STATS_REBUILD_SQL, NETWORK_STATS_REBUILD_SQL } from "#api/indexer/network-stats";

const INCREMENTAL_STATS_MIGRATION = readFileSync("migrations-core/0013_incremental_network_stats.sql", "utf8");

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
  assert.equal(row.assets, 2);
  assert.equal(row.transactions, 3);
  assert.equal(row.balances, 4);
  assert.equal(row.holders, 2);
  assert.equal(row.sends, 3);
  assert.equal(row.btc_fees, 1.5);
  assert.equal(row.xcp_destroyed, 1);
  assert.equal(row.xcp_supply, "400000000");
  assert.ok(row.updated_at > 0);
});

test("compact network stats derive the same totals through normalized asset identity", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE assets(asset_id INTEGER); CREATE TABLE transactions(fee TEXT); CREATE TABLE balances(quantity TEXT);
    CREATE TABLE sends(x INTEGER); CREATE TABLE dispensers(x INTEGER); CREATE TABLE dispenses(x INTEGER);
    CREATE TABLE orders(x INTEGER); CREATE TABLE order_matches(x INTEGER); CREATE TABLE broadcasts(x INTEGER);
    CREATE TABLE fairmints(x INTEGER); CREATE TABLE burns(earned TEXT); CREATE TABLE issuances(fee_paid TEXT,status TEXT);
    CREATE TABLE sweeps(fee_paid TEXT); CREATE TABLE dividends(fee_paid TEXT);
    CREATE TABLE destructions(asset_id INTEGER,quantity TEXT,status TEXT);
    CREATE TABLE network_stats_snapshot(
      singleton INTEGER PRIMARY KEY,assets INTEGER DEFAULT 0,transactions INTEGER DEFAULT 0,
      balances INTEGER DEFAULT 0,sends INTEGER DEFAULT 0,issuances INTEGER DEFAULT 0,
      dispensers INTEGER DEFAULT 0,dispenses INTEGER DEFAULT 0,orders INTEGER DEFAULT 0,
      order_matches INTEGER DEFAULT 0,sweeps INTEGER DEFAULT 0,broadcasts INTEGER DEFAULT 0,
      dividends INTEGER DEFAULT 0,fairmints INTEGER DEFAULT 0,destructions INTEGER DEFAULT 0,
      holders INTEGER DEFAULT 0,btc_fees REAL DEFAULT 0,xcp_destroyed REAL DEFAULT 0,
      xcp_supply TEXT DEFAULT '0',updated_at INTEGER DEFAULT 0);
    INSERT INTO network_stats_snapshot(singleton) VALUES(1);
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'OTHER'); INSERT INTO assets VALUES(1),(2);
    INSERT INTO transactions VALUES('100000000'),('50000000'),(NULL);
    INSERT INTO balances VALUES('1'),('0'),('-1'),('20'); INSERT INTO sends VALUES(1),(2),(3);
    INSERT INTO burns VALUES('500000000'); INSERT INTO issuances VALUES('10000000','valid'),('90000000','invalid');
    INSERT INTO sweeps VALUES('20000000'); INSERT INTO dividends VALUES('30000000');
    INSERT INTO destructions VALUES(1,'40000000','valid'),(2,'90000000','valid');
  `);
  db.exec(CORE_NETWORK_STATS_REBUILD_SQL);
  const row = db.prepare("SELECT * FROM network_stats_snapshot WHERE singleton=1").get() as Record<string, number>;
  assert.equal(row.assets, 2);
  assert.equal(row.transactions, 3);
  assert.equal(row.balances, 4);
  assert.equal(row.holders, 2);
  assert.equal(row.sends, 3);
  assert.equal(row.btc_fees, 1.5);
  assert.equal(row.xcp_destroyed, 1);
  assert.equal(row.xcp_supply, "400000000");
  assert.ok(row.updated_at > 0);

  db.exec(INCREMENTAL_STATS_MIGRATION);
  const baseline = { ...(db.prepare("SELECT * FROM network_stats_snapshot WHERE singleton=1").get() as object) };
  db.exec(`
    INSERT INTO sends VALUES(4); INSERT INTO balances VALUES('5'); INSERT INTO transactions VALUES('25000000');
    INSERT INTO burns VALUES('100000000'); INSERT INTO issuances VALUES('5000000','valid');
  `);
  const changed = db.prepare("SELECT * FROM network_stats_snapshot WHERE singleton=1").get() as Record<string, number>;
  assert.equal(changed.sends, 4);
  assert.equal(changed.balances, 5);
  assert.equal(changed.holders, 3);
  assert.equal(changed.transactions, 4);
  assert.equal(changed.btc_fees, 1.75);
  assert.equal(changed.xcp_destroyed, 1.05);
  assert.equal(changed.xcp_supply, "495000000");
  db.exec(`
    DELETE FROM sends WHERE x=4; DELETE FROM balances WHERE quantity='5';
    DELETE FROM transactions WHERE fee='25000000'; DELETE FROM burns WHERE earned='100000000';
    DELETE FROM issuances WHERE fee_paid='5000000' AND status='valid';
  `);
  const restored = {
    ...(db.prepare("SELECT * FROM network_stats_snapshot WHERE singleton=1").get() as object),
  } as Record<string, unknown>;
  restored.updated_at = (baseline as Record<string, unknown>).updated_at;
  assert.deepEqual(restored, baseline);
});
