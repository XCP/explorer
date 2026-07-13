import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { stampProtectionSourcePage } from "#api/recovery/stamp-source";

class Statement {
  bindings: unknown[] = [];
  constructor(private readonly rows: Array<{ event_index: number; tx_hash: string; description: string | null }>) {}
  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }
  async all<T>() {
    const [cursor, limit] = this.bindings as [number, number];
    return {
      results: this.rows.filter((row) => row.event_index > cursor).slice(0, limit) as T[],
      success: true,
      meta: {},
    };
  }
}

test("Stamp protection is derived from each issuance description, not the asset tag", async () => {
  const rows = [
    { event_index: 10, tx_hash: "AA".repeat(32), description: "stamp:iVBORw0KGgo" },
    { event_index: 11, tx_hash: "BB".repeat(32), description: "ordinary reissuance" },
    { event_index: 12, tx_hash: "CC".repeat(32), description: "mentions stamp:iVBOR but is not one" },
  ];
  const statement = new Statement(rows);
  const db = { prepare: () => statement } as unknown as D1Database;

  const page = await stampProtectionSourcePage(db, 0, 10);

  assert.deepEqual(page.transactions, [{ txid: "aa".repeat(32), source_reference: "issuance:10" }]);
  assert.equal(page.scanned, 3);
  assert.equal(page.next_cursor, null);
});

test("Stamp source pagination advances across non-Stamp issuances", async () => {
  const rows = [
    { event_index: 20, tx_hash: "11".repeat(32), description: null },
    { event_index: 21, tx_hash: "22".repeat(32), description: "ordinary" },
    { event_index: 22, tx_hash: "33".repeat(32), description: "stamp:R0lGOD" },
  ];
  const db = { prepare: () => new Statement(rows) } as unknown as D1Database;

  const first = await stampProtectionSourcePage(db, 0, 2);
  assert.deepEqual(first.transactions, []);
  assert.equal(first.next_cursor, 21);

  const second = await stampProtectionSourcePage(db, first.next_cursor!, 2);
  assert.equal(second.transactions[0]?.source_reference, "issuance:22");
  assert.equal(second.next_cursor, null);
});

test("issuance source scan uses the event-index seek", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE issuances (
      id INTEGER PRIMARY KEY,
      event_index INTEGER,
      tx_hash TEXT NOT NULL,
      description TEXT,
      status TEXT
    );
    CREATE UNIQUE INDEX idx_iss_evidx ON issuances(event_index);
  `);
  const plan = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT event_index,tx_hash,description FROM issuances
       WHERE event_index>? AND status='valid' ORDER BY event_index LIMIT ?`,
    )
    .all(0, 100) as Array<{ detail: string }>;
  assert.match(
    plan.map((row) => row.detail).join("\n"),
    /SEARCH issuances USING INDEX idx_iss_evidx \(event_index>\?\)/,
  );
});
