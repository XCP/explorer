import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  getCoreState,
  getCoreStateInt,
  getCoreStateStringArray,
  setCoreState,
  setCoreStateStatement,
} from "#api/indexer/core-state";

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
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }
  async run() {
    this.db.prepare(this.sql).run(...this.args);
    return { success: true };
  }
}

const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("core state has one typed, convergent access path", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
  const db = d1(sqlite);
  assert.equal(await getCoreState(db, "missing"), null);
  assert.equal(await getCoreStateInt(db, "missing", 7), 7);
  await setCoreState(db, "count", 12);
  await setCoreState(db, "items", JSON.stringify(["a", "b"]));
  await setCoreStateStatement(db, "count", 13).run();
  assert.equal(await getCoreStateInt(db, "count"), 13);
  assert.deepEqual(await getCoreStateStringArray(db, "items"), ["a", "b"]);
  await setCoreState(db, "items", "not-json");
  assert.deepEqual(await getCoreStateStringArray(db, "items"), []);
  sqlite.close();
});
