import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getTagStats, listTagAssetMembers } from "#api/queries/tags";

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
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

function d1(db: DatabaseSync): D1Database {
  return { prepare: (sql: string) => new Statement(db, sql) } as unknown as D1Database;
}

test("compact tags restore polymorphic identities and deterministic asset members", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,asset_longname TEXT,supply TEXT);
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,PRIMARY KEY(entity_id,tag));
    CREATE TABLE asset_signals(
      asset_id INTEGER PRIMARY KEY,holders INTEGER,distinct_traders INTEGER,distinct_dispense_buyers INTEGER,
      max_realized_usd REAL,trades INTEGER,dispenses INTEGER,low_quality INTEGER,avg_holder_dex REAL,
      pct_creator_holders REAL,supply REAL
    );
    CREATE TABLE asset_ratings(asset_id INTEGER PRIMARY KEY,rating REAL);
    INSERT INTO entity_dictionary VALUES(1,'asset','ALPHA'),(2,'asset','BETA'),(3,'address','holder');
    INSERT INTO asset_dictionary VALUES(10,'ALPHA'),(11,'BETA');
    INSERT INTO assets VALUES(10,'ALPHA.ONE','999'),(11,NULL,'888');
    INSERT INTO tags VALUES(1,'set','curated',NULL,'{"collection":"Set"}'),
      (2,'set','curated',NULL,'{"collection":"Set"}'),(3,'set','computed',NULL,NULL);
    INSERT INTO asset_signals VALUES(10,3,2,1,12,1,0,0,5,10,12),(11,1,0,0,0,0,0,0,0,0,2);
    INSERT INTO asset_ratings VALUES(10,8.2),(11,3.1);
  `);

  const stats = await getTagStats(d1(db), "holders", "set");
  assert.equal(stats?.n, 3);
  assert.equal(stats?.n_assets, 2);
  assert.equal(stats?.n_addresses, 1);
  assert.equal(stats?.total_holders, 4);

  // Both joined tables expose `supply`; the query must score against the signal projection unambiguously.
  const members = (await listTagAssetMembers(d1(db), "set", 10, 0)).map((row) => ({ ...row }));
  assert.deepEqual(
    members.map(({ asset, asset_longname, rating }) => ({ asset, asset_longname, rating })),
    [
      { asset: "ALPHA", asset_longname: "ALPHA.ONE", rating: 8.2 },
      { asset: "BETA", asset_longname: null, rating: 3.1 },
    ],
  );
});
