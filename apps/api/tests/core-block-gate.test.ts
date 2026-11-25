import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runCoreBlockGated } from "#api/scheduler/core-block-gate";

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
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

test("compact block gate advances only after successful work", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE blocks(block_index INTEGER PRIMARY KEY);
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO blocks VALUES(200);
  `);
  const db = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  let calls = 0;
  assert.equal(await runCoreBlockGated(db, "job", 144, async () => calls++), true);
  assert.equal(await runCoreBlockGated(db, "job", 144, async () => calls++), false);
  assert.equal(calls, 1);
  sqlite.exec(`UPDATE blocks SET block_index=344`);
  let failed = false;
  try {
    await runCoreBlockGated(db, "job", 144, async () => Promise.reject(new Error("failed")));
  } catch {
    failed = true;
  }
  assert.equal(failed, true);
  assert.equal(sqlite.prepare(`SELECT value FROM core_state WHERE key='job'`).get()?.value, "200");
  assert.equal(await runCoreBlockGated(db, "job", 144, async () => calls++), false);
  assert.equal(calls, 1);
  sqlite.exec("UPDATE core_state SET value='0' WHERE key='job_retry_after'");
  assert.equal(
    await runCoreBlockGated(
      db,
      "job",
      144,
      async () => ({ failed: true }),
      (r) => !r.failed,
    ),
    false,
  );
  assert.equal(await runCoreBlockGated(db, "job", 144, async () => calls++), false);
  assert.equal(calls, 1);
});
