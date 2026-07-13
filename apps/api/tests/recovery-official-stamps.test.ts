import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_state (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE recovery_protected_transactions (
      txid TEXT PRIMARY KEY, protection_kind TEXT NOT NULL, protected_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE recovery_protection_sources (
      txid TEXT NOT NULL, source TEXT NOT NULL, source_reference TEXT NOT NULL, recorded_at INTEGER NOT NULL,
      PRIMARY KEY (txid,source,source_reference)
    ) WITHOUT ROWID;
    CREATE TABLE recovery_stamp_import_receipts (
      page_cursor INTEGER PRIMARY KEY, next_cursor INTEGER, rows_seen INTEGER NOT NULL,
      snapshot_sha256 TEXT NOT NULL, recorded_at INTEGER NOT NULL
    );
  `);
  return db;
}

test("official btc_stamps provenance is additive and preserves issuance provenance", () => {
  const db = database();
  const shared = "11".repeat(32);
  const officialOnly = "22".repeat(32);
  const insertProtected = db.prepare(
    `INSERT INTO recovery_protected_transactions VALUES (?,'stamp',unixepoch()) ON CONFLICT(txid) DO NOTHING`,
  );
  const insertSource = db.prepare(
    `INSERT INTO recovery_protection_sources VALUES (?,?,?,unixepoch()) ON CONFLICT DO NOTHING`,
  );
  insertProtected.run(shared);
  insertSource.run(shared, "issuance-description", "issuance:1");
  insertProtected.run(shared);
  insertSource.run(shared, "btc-stamps-indexer", "stamp:0");
  insertProtected.run(officialOnly);
  insertSource.run(officialOnly, "btc-stamps-indexer", "stamp:1");

  assert.equal(
    (db.prepare(`SELECT COUNT(*) count FROM recovery_protected_transactions`).get() as { count: number }).count,
    2,
  );
  assert.equal(
    (
      db
        .prepare(`SELECT COUNT(*) count FROM recovery_protection_sources WHERE source='issuance-description'`)
        .get() as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT o.txid) count FROM recovery_protection_sources o
        WHERE o.source='btc-stamps-indexer' AND NOT EXISTS (
          SELECT 1 FROM recovery_protection_sources i
           WHERE i.txid=o.txid AND i.source='issuance-description')`,
        )
        .get() as { count: number }
    ).count,
    1,
  );
});

test("official btc_stamps page receipts reject divergent snapshot replays", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_stamp_import_receipts VALUES (-1,100,50,?,unixepoch())`).run("aa".repeat(32));
  assert.throws(
    () =>
      db.prepare(`INSERT INTO recovery_stamp_import_receipts VALUES (-1,100,50,?,unixepoch())`).run("bb".repeat(32)),
    /UNIQUE constraint failed/,
  );
});
