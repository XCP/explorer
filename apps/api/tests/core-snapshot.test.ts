import assert from "node:assert/strict";
import { test } from "node:test";
import { coreSnapshotPage } from "#api/indexer/core-snapshot";

function database(rows: Record<string, unknown>[], statements: string[]): D1Database {
  return {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: rows };
        },
      };
    },
  } as unknown as D1Database;
}

test("rowid snapshots finish against the observed high-water, not page length", async () => {
  const statements: string[] = [];
  const rows = [
    { _snapshot_rowid: 101, _snapshot_high_water: 500, asset: "A" },
    { _snapshot_rowid: 450, _snapshot_high_water: 500, asset: "B" },
  ];
  const page = await coreSnapshotPage(database(rows, statements), "assets", 100, 2);

  assert.equal(page.cursor, 450);
  assert.equal(page.high_water, 500);
  assert.equal(page.caught_up, false);
  assert.match(statements[0], /max\(rowid\)/);
  assert.match(statements[0], /WHERE rowid>\? ORDER BY rowid LIMIT \?/);
});

test("rowid snapshots close exactly at the observed high-water", async () => {
  const page = await coreSnapshotPage(
    database([{ _snapshot_rowid: 500, _snapshot_high_water: 500 }], []),
    "assets",
    450,
    100,
  );
  assert.equal(page.caught_up, true);
});

test("snapshot table names remain closed to the manifest", async () => {
  let message = "";
  try {
    await coreSnapshotPage(database([], []), "assets; DROP TABLE assets", 0, 100);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message, "unsupported snapshot table: assets; DROP TABLE assets");
});
