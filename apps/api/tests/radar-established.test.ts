import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { radarEstablished } from "#api/queries/radar";

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));

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
}

test("Established ranks eligible conviction regardless of market value or graph classification", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) sqlite.exec(migration);
  sqlite.exec(`
    INSERT INTO asset_dictionary(asset) VALUES('ESTABLISHED'),('UNCLASSIFIED');
    INSERT INTO assets(asset_id,supply_normalized) SELECT asset_id,'100' FROM asset_dictionary;
    INSERT INTO asset_signals(asset_id,holders,supply,graph_trust,graph_distrust,max_realized_usd,
      avg_holder_dex,pct_creator_holders) SELECT asset_id,20,100,2,0,10000,10,20
      FROM asset_dictionary WHERE asset='ESTABLISHED';
    INSERT INTO asset_signals(asset_id,holders,supply,graph_trust,graph_distrust,max_realized_usd,
      avg_holder_dex,pct_creator_holders) SELECT asset_id,20,100,0,0,0,10,20
      FROM asset_dictionary WHERE asset='UNCLASSIFIED';
  `);
  const db = { prepare: (sql: string) => new Statement(sqlite, sql) } as unknown as D1Database;
  const rows = await radarEstablished(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].asset, "ESTABLISHED");
  assert.equal(rows[0].market_usd, 10000);
  assert.equal(rows[1].asset, "UNCLASSIFIED");
  sqlite.close();
});
