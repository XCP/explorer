import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  coreHomeOverview,
  coreMetricSeries,
  coreNetworkCounts,
  coreNetworkTotals,
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
