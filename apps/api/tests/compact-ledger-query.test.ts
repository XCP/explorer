import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ADDRESS_LEDGER_SQL } from "../src/queries/compact-ledger";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT NOT NULL UNIQUE);
    CREATE TABLE ledger_events(event_index INTEGER PRIMARY KEY,direction INTEGER NOT NULL,block_index INTEGER NOT NULL,
      tx_hash BLOB,address_id INTEGER NOT NULL,asset_id INTEGER NOT NULL,quantity TEXT NOT NULL,calling_function TEXT,utxo_address_id INTEGER);
    CREATE INDEX idx_ledger_address_page ON ledger_events(address_id,block_index DESC,tx_hash,event_index);
    INSERT INTO address_dictionary VALUES(1,'addr'); INSERT INTO asset_dictionary VALUES(1,'XCP');
  `);
  const insert = db.prepare(`INSERT INTO ledger_events VALUES(?,?,?,?,?,?,?,?,NULL)`);
  insert.run(40, 1, 101, null, 1, 1, "4", "credit");
  insert.run(30, 0, 99, new Uint8Array(32).fill(0xff), 1, 1, "3", "debit");
  insert.run(20, 1, 100, new Uint8Array(32).fill(0xbb), 1, 1, "2", "credit");
  insert.run(10, 1, 100, new Uint8Array(32).fill(0xaa), 1, 1, "1", "credit");
  return db;
}

test("compact ledger preserves public block/hash ordering and offset pages", () => {
  const db = fixture();
  const rows = db.prepare(ADDRESS_LEDGER_SQL).all("addr", 3, 0) as { tx_hash: string | null; direction: string }[];
  assert.deepEqual(rows.map((r) => r.tx_hash), [null, "aa".repeat(32), "bb".repeat(32)]);
  assert.deepEqual(rows.map((r) => r.direction), ["in", "in", "in"]);
  const last = db.prepare(ADDRESS_LEDGER_SQL).get("addr", 1, 3) as { tx_hash: string; direction: string };
  assert.equal(last.tx_hash, "ff".repeat(32));
  assert.equal(last.direction, "out");
});

test("compact ledger filters through the indexed base table before decoding", () => {
  const db = fixture();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${ADDRESS_LEDGER_SQL}`).all("addr", 50, 0) as { detail: string }[];
  assert.equal(plan.some((row) => row.detail.includes("idx_ledger_address_page")), true);
  assert.equal(plan.some((row) => row.detail === "SCAN ledger_events"), false);
});
