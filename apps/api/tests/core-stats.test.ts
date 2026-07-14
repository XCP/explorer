import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { coreHomeOverview, coreNetworkCounts, coreNetworkTotals, coreSyncOverview } from "#api/queries/core-stats";

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
