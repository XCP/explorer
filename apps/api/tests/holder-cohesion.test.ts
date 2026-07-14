import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Env } from "#api/env";
import { buildHolderCohesion } from "#api/indexer/holder-cohesion";

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
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

test("holder cohesion uses compact holder identities and only the published graph generation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY,holders INTEGER,max_realized_usd REAL,
      holder_cohesion REAL,cohesion_edges INTEGER,cohesion_strong INTEGER);
    CREATE TABLE balances(asset_id INTEGER,address_id INTEGER,quantity TEXT);
    CREATE TABLE graph_edges(generation INTEGER,source_entity_id INTEGER,destination_entity_id INTEGER,weight REAL);
    INSERT INTO core_state VALUES('graph_generation','1');
    INSERT INTO asset_dictionary VALUES(10,'CARD'),(20,'LATER');
    INSERT INTO asset_signals VALUES(10,15,100,NULL,NULL,NULL),(20,15,0,NULL,NULL,NULL);
    INSERT INTO balances VALUES(10,1,'30'),(10,2,'20'),(10,3,'10'),(10,NULL,'999');
    INSERT INTO graph_edges VALUES
      (1,1,2,2.0),(1,2,1,1.7),(1,2,3,1.0),(1,1,9,9.0),(0,1,3,9.0);
  `);
  const core = {
    prepare: (sql: string) => new Statement(sqlite, sql),
  } as unknown as D1Database;
  const result = await buildHolderCohesion({ CORE_DB: core } as Env, "0", 10);
  assert.deepEqual(result, {
    processed: 1,
    next: "10",
    sample: [{ asset: "CARD", cohesion: 1, edges: 3, strong: 2 }],
  });
  assert.deepEqual(
    {
      ...sqlite
        .prepare(`SELECT holder_cohesion,cohesion_edges,cohesion_strong FROM asset_signals WHERE asset_id=10`)
        .get(),
    },
    { holder_cohesion: 1, cohesion_edges: 3, cohesion_strong: 2 },
  );
  assert.equal((await buildHolderCohesion({ CORE_DB: core } as Env, "10", 10)).processed, 0);
});
