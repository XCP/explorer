import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  coreHomeOverview,
  coreMetricSeries,
  coreNetworkCounts,
  coreNetworkTotals,
  coreQualityNetworkStats,
  coreSyncOverview,
} from "#api/queries/core-stats";

const DAILY_METRICS_MIGRATION = readFileSync("migrations-core/0012_daily_metrics.sql", "utf8");

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
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
}

function d1(db: DatabaseSync): D1Database {
  return { prepare: (sql: string) => new Statement(db, sql) } as unknown as D1Database;
}

test("compact overview reads one snapshot and reports the canonical block position", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE blocks(block_index INTEGER PRIMARY KEY);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY);
    CREATE TABLE burns(x INTEGER); CREATE TABLE fairminters(x INTEGER); CREATE TABLE bets(x INTEGER);
    CREATE TABLE bet_matches(x INTEGER); CREATE TABLE btcpays(x INTEGER); CREATE TABLE cancels(x INTEGER);
    CREATE TABLE rps(x INTEGER); CREATE TABLE rps_matches(x INTEGER);
    CREATE TABLE pools(x INTEGER); CREATE TABLE pool_matches(x INTEGER); CREATE TABLE pool_liquidity(kind TEXT);
    CREATE TABLE network_stats_snapshot(
      singleton INTEGER PRIMARY KEY,assets INTEGER,transactions INTEGER,balances INTEGER,sends INTEGER,
      issuances INTEGER,dispensers INTEGER,dispenses INTEGER,orders INTEGER,order_matches INTEGER,
      sweeps INTEGER,broadcasts INTEGER,dividends INTEGER,fairmints INTEGER,destructions INTEGER,
      holders INTEGER,btc_fees REAL,xcp_destroyed REAL);
    INSERT INTO blocks VALUES(100),(101);
    INSERT INTO network_stats_snapshot VALUES(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,1.5,2.5);
  `);
  const dbBinding = d1(db);
  assert.deepEqual(
    { ...(await coreHomeOverview(dbBinding)) },
    {
      tip: 101,
      assets: 2,
      transactions: 3,
      balances: 4,
      indexed_block: "101",
    },
  );
  assert.deepEqual({ ...(await coreSyncOverview(dbBinding)) }, { tip: 101, indexed_block: "101" });
  assert.deepEqual(
    { ...(await coreNetworkCounts(dbBinding)) },
    {
      tip: 101,
      assets: 2,
      addresses: 0,
      transactions: 3,
      sends: 5,
      issuances: 6,
      dispensers: 7,
      dispenses: 8,
      orders: 9,
      order_matches: 10,
      sweeps: 11,
      broadcasts: 12,
      dividends: 13,
      fairmints: 14,
      destructions: 15,
      burns: 0,
      fairminters: 0,
      bets: 0,
      bet_matches: 0,
      btcpays: 0,
      cancels: 0,
      rps: 0,
      rps_matches: 0,
      pools: 0,
      pool_matches: 0,
      pool_deposits: 0,
      pool_withdrawals: 0,
      holders: 16,
    },
  );
  assert.deepEqual({ ...(await coreNetworkTotals(dbBinding)) }, { btc_fees: 1.5, xcp_destroyed: 2.5 });
});

test("compact daily metrics preserve day buckets and monetary normalization", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    INSERT INTO asset_dictionary VALUES(1,'BTC'),(2,'XCP');
    CREATE TABLE blocks(block_time INTEGER,transaction_count INTEGER);
    CREATE TABLE transactions(block_time INTEGER,fee TEXT);
    CREATE TABLE issuances(block_time INTEGER,fee_paid TEXT,status TEXT);
    CREATE TABLE dispenses(block_time INTEGER); CREATE TABLE order_matches(block_time INTEGER);
    CREATE TABLE sends(block_time INTEGER); CREATE TABLE sweeps(block_time INTEGER,fee_paid TEXT);
    CREATE TABLE dividends(block_time INTEGER,fee_paid TEXT);
    CREATE TABLE destructions(block_time INTEGER,quantity TEXT,asset_id INTEGER,status TEXT);
    INSERT INTO blocks VALUES(86400,2),(86500,3),(172800,4);
    INSERT INTO transactions VALUES(86400,'10000000'),(172800,'20000000');
    INSERT INTO issuances VALUES(86400,'100000000','valid'),(172800,'900000000','invalid');
    INSERT INTO dispenses VALUES(86400),(172800); INSERT INTO order_matches VALUES(86400),(86401);
    INSERT INTO sends VALUES(172800); INSERT INTO sweeps VALUES(86400,'200000000');
    INSERT INTO dividends VALUES(86400,'300000000');
    INSERT INTO destructions VALUES(86400,'400000000',2,'valid'),(86400,'800000000',1,'valid');
  `);
  db.exec(DAILY_METRICS_MIGRATION);
  const binding = d1(db);
  const series = async (name: Parameters<typeof coreMetricSeries>[1]) =>
    (await coreMetricSeries(binding, name, 7)).map((row) => ({ ...row }));
  assert.deepEqual(await series("transactions"), [
    { d: 2, v: 4 },
    { d: 1, v: 5 },
  ]);
  assert.deepEqual(await series("trades"), [{ d: 1, v: 2 }]);
  assert.deepEqual(await series("dispenses"), [
    { d: 2, v: 1 },
    { d: 1, v: 1 },
  ]);
  assert.deepEqual(await series("sends"), [{ d: 2, v: 1 }]);
  assert.deepEqual(await series("btc_fees"), [
    { d: 2, v: 0.2 },
    { d: 1, v: 0.1 },
  ]);
  assert.deepEqual(await series("xcp_burned"), [{ d: 1, v: 10 }]);

  db.exec(`INSERT INTO sends VALUES(259200); DELETE FROM sends WHERE block_time=172800;`);
  assert.deepEqual(await series("sends"), [{ d: 3, v: 1 }]);
});

test("quality stats exclude low-quality asset activity without removing unscoped protocol activity", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE blocks(block_index INTEGER PRIMARY KEY);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY);
    CREATE TABLE network_stats_snapshot(singleton INTEGER PRIMARY KEY,assets INTEGER,transactions INTEGER,sends INTEGER,
      issuances INTEGER,dispensers INTEGER,dispenses INTEGER,sweeps INTEGER,broadcasts INTEGER,dividends INTEGER,
      fairmints INTEGER,destructions INTEGER,holders INTEGER);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY,low_quality INTEGER);
    CREATE TABLE assets(asset_id INTEGER); CREATE TABLE transactions(tx_index INTEGER,fee TEXT);
    CREATE TABLE sends(tx_index INTEGER,asset_id INTEGER); CREATE TABLE issuances(tx_index INTEGER,asset_id INTEGER,status TEXT,fee_paid TEXT);
    CREATE TABLE dispensers(tx_index INTEGER,asset_id INTEGER); CREATE TABLE dispenses(tx_index INTEGER,asset_id INTEGER);
    CREATE TABLE orders(tx_index INTEGER,give_asset_id INTEGER,get_asset_id INTEGER);
    CREATE TABLE order_matches(tx0_index INTEGER,tx1_index INTEGER,forward_asset_id INTEGER,backward_asset_id INTEGER);
    CREATE TABLE sweeps(fee_paid TEXT); CREATE TABLE broadcasts(x INTEGER);
    CREATE TABLE dividends(tx_index INTEGER,asset_id INTEGER,fee_paid TEXT);
    CREATE TABLE fairmints(tx_index INTEGER,asset_id INTEGER); CREATE TABLE destructions(tx_index INTEGER,asset_id INTEGER,status TEXT,quantity TEXT);
    CREATE TABLE balances(asset_id INTEGER,quantity TEXT);
    CREATE TABLE burns(x INTEGER); CREATE TABLE fairminters(asset_id INTEGER); CREATE TABLE bets(x INTEGER);
    CREATE TABLE bet_matches(x INTEGER);
    CREATE TABLE btcpays(order_match_tx0_index INTEGER,order_match_tx1_index INTEGER);
    CREATE TABLE cancels(x INTEGER); CREATE TABLE rps(x INTEGER); CREATE TABLE rps_matches(x INTEGER);
    CREATE TABLE pools(asset_a_id INTEGER,asset_b_id INTEGER);
    CREATE TABLE pool_matches(forward_asset_id INTEGER,backward_asset_id INTEGER);
    CREATE TABLE pool_liquidity(asset_a_id INTEGER,asset_b_id INTEGER,kind TEXT);
    INSERT INTO blocks VALUES(100);
    INSERT INTO network_stats_snapshot VALUES(1,3,3,2,2,2,2,1,1,2,2,2,2);
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'CLEAN'),(3,'JUNK');
    INSERT INTO asset_signals VALUES(2,0),(3,1); INSERT INTO assets VALUES(1),(2),(3);
    INSERT INTO transactions VALUES(10,'10000000'),(11,'20000000'),(12,'30000000');
    INSERT INTO sends VALUES(10,2),(11,3); INSERT INTO issuances VALUES(10,2,'valid','100000000'),(11,3,'valid','900000000');
    INSERT INTO dispensers VALUES(10,2),(11,3); INSERT INTO dispenses VALUES(10,2),(11,3);
    INSERT INTO orders VALUES(10,2,1),(11,2,3); INSERT INTO order_matches VALUES(1,2,2,1),(3,4,2,3);
    INSERT INTO sweeps VALUES('200000000'); INSERT INTO broadcasts VALUES(1);
    INSERT INTO dividends VALUES(10,2,'300000000'),(11,3,'700000000');
    INSERT INTO fairmints VALUES(10,2),(11,3);
    INSERT INTO destructions VALUES(12,1,'valid','400000000'),(11,3,'valid','800000000');
    INSERT INTO balances VALUES(2,'1'),(3,'1'),(2,'0');
  `);
  assert.deepEqual(
    { ...(await coreQualityNetworkStats(d1(db))) },
    {
      tip: 100,
      assets: 2,
      addresses: 0,
      transactions: 3,
      sends: 1,
      issuances: 1,
      dispensers: 1,
      dispenses: 1,
      orders: 1,
      order_matches: 1,
      sweeps: 1,
      broadcasts: 1,
      dividends: 1,
      fairmints: 1,
      destructions: 1,
      burns: 0,
      fairminters: 0,
      bets: 0,
      bet_matches: 0,
      btcpays: 0,
      cancels: 0,
      rps: 0,
      rps_matches: 0,
      pools: 0,
      pool_matches: 0,
      pool_deposits: 0,
      pool_withdrawals: 0,
      holders: 1,
      btc_fees: 0.4,
      xcp_destroyed: 10,
    },
  );
  db.close();
});
