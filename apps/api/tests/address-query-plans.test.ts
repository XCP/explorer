import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE issuances(source TEXT,issuer TEXT,block_index INTEGER);
    CREATE INDEX idx_iss_src ON issuances(source,block_index DESC);
    CREATE INDEX idx_iss_issuer ON issuances(issuer,block_index DESC);

    CREATE TABLE dispenses(source TEXT,destination TEXT,block_index INTEGER);
    CREATE INDEX idx_dispe_source ON dispenses(source,block_index DESC);
    CREATE INDEX idx_dispe_dest ON dispenses(destination,block_index DESC);

    CREATE TABLE order_matches(tx0_address TEXT,tx1_address TEXT,block_index INTEGER);
    CREATE INDEX idx_om_addr ON order_matches(tx0_address,block_index DESC);
    CREATE INDEX idx_om_addr1 ON order_matches(tx1_address,block_index DESC);

    CREATE TABLE sweeps(source TEXT,destination TEXT,block_index INTEGER);
    CREATE INDEX idx_sweeps_src ON sweeps(source,block_index DESC);
    CREATE INDEX idx_sweeps_dest ON sweeps(destination,block_index DESC);
  `);
  return db;
}

function details(db: DatabaseSync, sql: string): string[] {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("addr", "addr") as { detail: string }[]).map(
    ({ detail }) => detail,
  );
}

function assertIndexedOr(plan: string[], indexes: string[]): void {
  assert.equal(
    plan.some((line) => line.startsWith("SCAN ")),
    false,
    plan.join("\n"),
  );
  for (const index of indexes) {
    assert.equal(
      plan.some((line) => line.includes(index)),
      true,
      `expected ${index} in:\n${plan.join("\n")}`,
    );
  }
}

test("address relationship queries seek both sides instead of scanning", () => {
  const db = fixture();
  assertIndexedOr(details(db, `SELECT * FROM issuances WHERE source=? OR issuer=?`), ["idx_iss_src", "idx_iss_issuer"]);
  assertIndexedOr(details(db, `SELECT * FROM dispenses WHERE source=? OR destination=?`), [
    "idx_dispe_source",
    "idx_dispe_dest",
  ]);
  assertIndexedOr(details(db, `SELECT * FROM order_matches WHERE tx0_address=? OR tx1_address=?`), [
    "idx_om_addr",
    "idx_om_addr1",
  ]);
  assertIndexedOr(details(db, `SELECT * FROM sweeps WHERE source=? OR destination=?`), [
    "idx_sweeps_src",
    "idx_sweeps_dest",
  ]);
});
