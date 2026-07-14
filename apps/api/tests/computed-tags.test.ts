import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Env } from "#api/env";
import { buildTags, buildTagsScoped } from "#api/indexer/tags";

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
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { rows_written: Number(result.changes) } };
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

function d1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

test("compact computed tags converge while preserving independently owned tags", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) sqlite.exec(migration);
  sqlite.exec(`
    INSERT INTO address_dictionary(address) VALUES('trader');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(900000,zeroblob(32),1);
    INSERT INTO assets(asset_id,type,first_issuance_block_index)
      SELECT asset_id,'asset',300000 FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO address_signals(address_id,dex_trades,first_block,last_block)
      SELECT address_id,100,100000,900000 FROM address_dictionary WHERE address='trader';
    INSERT INTO asset_signals(asset_id,trades,holders)
      SELECT asset_id,10,50 FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO entity_dictionary(entity_type,entity_key) VALUES('asset','CARD');
    INSERT INTO tags(entity_id,tag,source)
      SELECT entity_id,'stamp','protocol' FROM entity_dictionary WHERE entity_key='CARD';
    INSERT INTO tags(entity_id,tag,source)
      SELECT entity_id,'broad','manual' FROM entity_dictionary WHERE entity_key='CARD';
  `);
  const env = { CORE_DB: d1(sqlite) } as Env;
  await buildTags(env);
  const tags = () =>
    sqlite
      .prepare(
        `SELECT entity.entity_key,tag.tag,tag.source FROM tags tag
    JOIN entity_dictionary entity ON entity.entity_id=tag.entity_id ORDER BY entity.entity_key,tag.tag`,
      )
      .all()
      .map((row) => ({ ...row }));
  assert.equal(
    tags().some((row) => row.entity_key === "trader" && row.tag === "active_trader"),
    true,
  );
  assert.equal(
    tags().some((row) => row.entity_key === "CARD" && row.tag === "liquid"),
    true,
  );
  assert.equal(
    tags().some((row) => row.entity_key === "CARD" && row.tag === "stamp" && row.source === "protocol"),
    true,
  );
  assert.equal(
    tags().some((row) => row.entity_key === "CARD" && row.tag === "broad" && row.source === "manual"),
    true,
  );

  sqlite.exec(`UPDATE address_signals SET dex_trades=0; UPDATE asset_signals SET trades=0,holders=0`);
  await buildTagsScoped(env, { assets: ["CARD"], addrs: ["trader"] });
  assert.equal(
    tags().some((row) => row.tag === "active_trader" || row.tag === "liquid"),
    false,
  );
  assert.equal(
    tags().some((row) => row.tag === "stamp" && row.source === "protocol"),
    true,
  );
  assert.equal(
    tags().some((row) => row.tag === "broad" && row.source === "manual"),
    true,
  );
});
