import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { invalidateCollectionReads } from "#api/indexer/collection-cache";

class Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  async run() {
    const result = this.db.prepare(this.sql).run();
    return { success: true,meta: { changes: result.changes } } as unknown as D1Result;
  }
}

test("collection refresh invalidates only the current derived read caches", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cache(key TEXT PRIMARY KEY);
    INSERT INTO cache VALUES('tags:all'),('collections:profiles:v3'),('collection-candidates:core:2'),('stats:all');`);
  const binding = { prepare: (sql: string) => new Statement(db, sql) } as unknown as D1Database;
  await invalidateCollectionReads(binding);
  assert.deepEqual(db.prepare(`SELECT key FROM cache ORDER BY key`).all().map((row) => ({ ...row })), [
    { key: "stats:all" },
  ]);
});
