import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { catchUpCoreAssetFeedCounts, rebuildCoreAssetFeedCounts } from "#api/indexer/core-feed-counts";

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
  async run() {
    this.db.prepare(this.sql).run(...this.values);
    return { success: true };
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  isRead() {
    return /^\s*(SELECT|WITH)\b/i.test(this.sql);
  }
}

function d1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      const results = [];
      for (const statement of statements)
        results.push(statement.isRead() ? await statement.all() : await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

test("compact feed counts converge from normalized canonical relations", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE asset_feed_counts(
      asset_id INTEGER PRIMARY KEY,sales INTEGER DEFAULT 0,issuances INTEGER DEFAULT 0,
      dispensers INTEGER DEFAULT 0,dispenses INTEGER DEFAULT 0,orders INTEGER DEFAULT 0,
      sends INTEGER DEFAULT 0,fairmints INTEGER DEFAULT 0,dividends INTEGER DEFAULT 0,
      destructions INTEGER DEFAULT 0,pools INTEGER DEFAULT 0,subassets INTEGER DEFAULT 0,updated_at INTEGER);
    CREATE TABLE trades(asset_id INTEGER); CREATE TABLE issuances(asset_id INTEGER);
    CREATE TABLE dispensers(asset_id INTEGER); CREATE TABLE dispenses(asset_id INTEGER);
    CREATE TABLE orders(give_asset_id INTEGER,get_asset_id INTEGER); CREATE TABLE sends(asset_id INTEGER);
    CREATE TABLE fairmints(asset_id INTEGER); CREATE TABLE dividends(asset_id INTEGER,dividend_asset_id INTEGER);
    CREATE TABLE destructions(asset_id INTEGER);
    CREATE TABLE pools(asset_a_id INTEGER,asset_b_id INTEGER,lp_asset TEXT);
    CREATE TABLE assets(asset_longname TEXT);
    INSERT INTO asset_dictionary VALUES(1,'A'),(2,'B');
    INSERT INTO trades VALUES(1); INSERT INTO issuances VALUES(1); INSERT INTO dispensers VALUES(1);
    INSERT INTO dispenses VALUES(1); INSERT INTO orders VALUES(1,1),(1,2); INSERT INTO sends VALUES(1);
    INSERT INTO fairmints VALUES(1); INSERT INTO dividends VALUES(1,1),(2,1);
    INSERT INTO destructions VALUES(1); INSERT INTO pools VALUES(1,2,'LP'),(2,2,'A');
    INSERT INTO assets VALUES('A.ONE'),('A.NESTED.TWO'),('B.ONE');
  `);
  assert.equal(await rebuildCoreAssetFeedCounts(d1(db), ["A", "A"]), 1);
  const read = () => ({ ...db.prepare(`SELECT * FROM asset_feed_counts WHERE asset_id=1`).get() });
  assert.deepEqual(read(), {
    asset_id: 1,
    sales: 1,
    issuances: 1,
    dispensers: 1,
    dispenses: 1,
    orders: 2,
    sends: 1,
    fairmints: 1,
    dividends: 2,
    destructions: 1,
    pools: 2,
    subassets: 2,
    updated_at: read().updated_at,
  });
  db.exec(`INSERT INTO sends VALUES(1);`);
  await rebuildCoreAssetFeedCounts(d1(db), ["A"]);
  assert.equal(read().sales, 1);
  assert.equal(read().sends, 2);
});

test("compact feed count catch-up scans only identities changed after the seed frontier", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO core_state VALUES('seed_block_index','100');
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    INSERT INTO asset_dictionary VALUES(1,'A'),(2,'A.ONE'),(3,'OLD');
    CREATE TABLE asset_feed_counts(
      asset_id INTEGER PRIMARY KEY,sales INTEGER DEFAULT 0,issuances INTEGER DEFAULT 0,
      dispensers INTEGER DEFAULT 0,dispenses INTEGER DEFAULT 0,orders INTEGER DEFAULT 0,
      sends INTEGER DEFAULT 0,fairmints INTEGER DEFAULT 0,dividends INTEGER DEFAULT 0,
      destructions INTEGER DEFAULT 0,pools INTEGER DEFAULT 0,subassets INTEGER DEFAULT 0,updated_at INTEGER);
    CREATE TABLE trades(asset_id INTEGER,block_index INTEGER);
    CREATE TABLE issuances(asset_id INTEGER,block_index INTEGER);
    CREATE TABLE dispensers(asset_id INTEGER,block_index INTEGER);
    CREATE TABLE dispenses(asset_id INTEGER,block_index INTEGER);
    CREATE TABLE orders(give_asset_id INTEGER,get_asset_id INTEGER,block_index INTEGER);
    CREATE TABLE sends(asset_id INTEGER,block_index INTEGER);
    CREATE TABLE fairmints(asset_id INTEGER,block_index INTEGER);
    CREATE TABLE dividends(asset_id INTEGER,dividend_asset_id INTEGER,block_index INTEGER);
    CREATE TABLE destructions(asset_id INTEGER,block_index INTEGER);
    CREATE TABLE pools(asset_a_id INTEGER,asset_b_id INTEGER,lp_asset TEXT,updated_block_index INTEGER);
    CREATE TABLE assets(asset_id INTEGER,asset_longname TEXT,last_issuance_block_index INTEGER);
    INSERT INTO assets VALUES(1,NULL,1),(2,'A.ONE',101),(3,NULL,1);
    INSERT INTO issuances VALUES(2,101),(3,99);
  `);
  const result = await catchUpCoreAssetFeedCounts(d1(db), 10);
  assert.deepEqual(result, { processed: 1, recomputed: 2, cursor: 2, caught_up: true });
  assert.equal(db.prepare(`SELECT subassets FROM asset_feed_counts WHERE asset_id=1`).get()!.subassets, 1);
  assert.equal(db.prepare(`SELECT issuances FROM asset_feed_counts WHERE asset_id=2`).get()!.issuances, 1);
  assert.equal(db.prepare(`SELECT * FROM asset_feed_counts WHERE asset_id=3`).get(), undefined);
  assert.equal(
    db.prepare(`SELECT value FROM core_state WHERE key='asset_feed_counts_native_complete'`).get()!.value,
    "1",
  );
});
