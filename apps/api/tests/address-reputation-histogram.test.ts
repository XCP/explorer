import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { refreshAddressReputationHistogram } from "#api/indexer/address-reputation";
import { reputationHistogram } from "#api/queries/addresses";

class Statement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { rows_written: Number(result.changes), changes: Number(result.changes) } };
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }
}

function d1(database: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Statement(database, sql),
  } as unknown as D1Database;
}

test("weekly reputation histogram rebuilds compact bins and removes stale bins", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE address_reputations(address_id INTEGER PRIMARY KEY,reputation REAL NOT NULL);
    CREATE TABLE address_reputation_histogram(
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      bins TEXT NOT NULL CHECK(json_valid(bins))
    );
    INSERT INTO address_reputations VALUES(1,0),(2,50.9),(3,50.1),(4,99.9),(5,100);
    INSERT INTO address_reputation_histogram VALUES(1,'[{"bin":42,"count":99}]');
  `);

  const binding = d1(database);
  assert.deepEqual(await refreshAddressReputationHistogram(binding), { changed: true });
  assert.deepEqual(
    (await reputationHistogram(binding)).map((row) => ({ ...row })),
    [
      { bin: 0, count: 1 },
      { bin: 50, count: 2 },
      { bin: 99, count: 1 },
      { bin: 100, count: 1 },
    ],
  );
  assert.deepEqual(await refreshAddressReputationHistogram(binding), { changed: false });

  database.prepare(`DELETE FROM address_reputations WHERE address_id<>5`).run();
  await refreshAddressReputationHistogram(binding);
  assert.deepEqual(
    (await reputationHistogram(binding)).map((row) => ({ ...row })),
    [{ bin: 100, count: 1 }],
  );
});
