import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { backfillDispenseIdentities, reconcileDispenseIdentities } from "#api/indexer/dispense-identity";

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
}

function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new Statement(db, sql);
    },
    async batch(statements: Statement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

test("dispense source identities backfill and converge on forward reconciliation", async () => {
  const source = new DatabaseSync(":memory:");
  const compact = new DatabaseSync(":memory:");
  source.exec(`CREATE TABLE dispenses(id INTEGER PRIMARY KEY,event_index INTEGER UNIQUE);
    INSERT INTO dispenses VALUES(207723,10),(207724,11),(207725,12);`);
  compact.exec(`CREATE TABLE dispenses(event_index INTEGER PRIMARY KEY,dispense_id INTEGER UNIQUE);
    INSERT INTO dispenses(event_index) VALUES(10),(11),(12);`);

  assert.deepEqual(await backfillDispenseIdentities(d1(source), d1(compact), 0, 2), {
    processed: 2,
    next: 207724,
    caught_up: false,
  });
  assert.equal(await reconcileDispenseIdentities(d1(source), d1(compact), [12]), 1);
  assert.deepEqual(
    compact
      .prepare(`SELECT event_index,dispense_id FROM dispenses ORDER BY event_index`)
      .all()
      .map((row) => ({ ...row })),
    [
      { event_index: 10, dispense_id: 207723 },
      { event_index: 11, dispense_id: 207724 },
      { event_index: 12, dispense_id: 207725 },
    ],
  );
});
