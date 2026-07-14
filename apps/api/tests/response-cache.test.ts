import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { claimCacheRefresh } from "#api/read/respond";

class Statement {
  private args: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { meta: { rows_written: result.changes } };
  }
}

test("only one stale-cache request owns a refresh lease", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE cache(key TEXT PRIMARY KEY,body TEXT,ctype TEXT,expires_at INTEGER,refreshing_until INTEGER NOT NULL);
    INSERT INTO cache VALUES('heavy','{}','application/json',0,0);
  `);
  const db = { prepare: (sql: string) => new Statement(sqlite, sql) } as unknown as D1Database;

  assert.equal(await claimCacheRefresh(db, "heavy", 100), true);
  assert.equal(await claimCacheRefresh(db, "heavy", 100), false);
  assert.equal(await claimCacheRefresh(db, "heavy", 161), true);
  assert.equal(await claimCacheRefresh(db, "missing", 161), false);
  sqlite.close();
});
