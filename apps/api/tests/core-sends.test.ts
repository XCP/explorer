import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listSends } from "#api/queries/records";

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
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
}

function d1(db: DatabaseSync): D1Database {
  return { prepare: (sql: string) => new Statement(db, sql) } as unknown as D1Database;
}

test("compact sends restore identities and preserve deterministic MPMA order", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE sends(
      event_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,
      source_id INTEGER,destination_id INTEGER,asset_id INTEGER,quantity_normalized TEXT,
      memo TEXT,send_type TEXT,status TEXT
    );
    INSERT INTO address_dictionary VALUES(1,'source'),(2,'first'),(3,'second');
    INSERT INTO asset_dictionary VALUES(1,'XCP');
    INSERT INTO sends VALUES
      (10,x'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',100,1000,1,2,1,'1.5','hello','mpma','valid'),
      (11,x'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',100,1000,1,3,1,'2.5',NULL,'mpma','valid');
  `);

  const rows = (await listSends(d1(db), 10, 0)).map((row) => ({ ...row }));
  assert.deepEqual(
    rows.map(({ destination, quantity_normalized, memo }) => ({ destination, quantity_normalized, memo })),
    [
      { destination: "second", quantity_normalized: "2.5", memo: null },
      { destination: "first", quantity_normalized: "1.5", memo: "hello" },
    ],
  );
  assert.equal(rows[0].tx_hash, "a".repeat(64));
});
