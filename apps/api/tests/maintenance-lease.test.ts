import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { withCanonicalMaintenanceLease } from "#api/scheduler/maintenance-lease";

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
    return { success: true, meta: { changes: result.changes } };
  }
}

test("canonical maintenance lease excludes overlap and releases after completion", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
  const db = { prepare: (sql: string) => new Statement(sqlite, sql) } as unknown as D1Database;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const first = withCanonicalMaintenanceLease(db, () => held);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    await withCanonicalMaintenanceLease(db, async () => {
      throw new Error("overlapping lease ran");
    }),
    false,
  );
  release();
  assert.equal(await first, true);
  assert.equal(await withCanonicalMaintenanceLease(db, async () => {}), true);
});

test("canonical maintenance lease releases after a failed chain", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
  const db = { prepare: (sql: string) => new Statement(sqlite, sql) } as unknown as D1Database;
  let failed = false;
  try {
    await withCanonicalMaintenanceLease(db, async () => {
      throw new Error("failed");
    });
  } catch {
    failed = true;
  }
  assert.equal(failed, true);
  assert.equal(await withCanonicalMaintenanceLease(db, async () => {}), true);
});
