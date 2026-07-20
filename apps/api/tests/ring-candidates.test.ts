import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ringCandidates } from "#api/queries/trades";

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
    return { results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[] };
  }
}

function d1(db: DatabaseSync): D1Database {
  return { prepare: (sql: string) => new Statement(db, sql) } as unknown as D1Database;
}

function harness() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trades(venue TEXT,ref TEXT,asset_id INTEGER,block_time INTEGER,usd_value REAL,
      buyer_id INTEGER,seller_id INTEGER,PRIMARY KEY(venue,ref));
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY,low_quality INTEGER);
    INSERT INTO asset_dictionary VALUES(1,'RINGCOIN'),(2,'HONESTART'),(3,'FLAGGED');
    INSERT INTO address_dictionary VALUES(1,'ring-a'),(2,'ring-b'),(3,'artist'),(4,'fan-one'),(5,'fan-two');
  `);
  return db;
}

/** n fills of `usd` each between one buyer and one seller. */
function fills(db: DatabaseSync, asset: number, seller: number, buyer: number, n: number, usd: number, tag: string) {
  for (let i = 0; i < n; i++) {
    db.prepare(`INSERT INTO trades VALUES('dex',?,?,1000,?,?,?)`).run(`${tag}:${i}`, asset, usd, buyer, seller);
  }
}

test("reciprocal pairs surface with their evidence while one-direction markets stay off the board", async () => {
  const db = harness();
  // RINGCOIN: ring-a and ring-b pass it back and forth — every dollar is reciprocal.
  fills(db, 1, 1, 2, 5, 400, "ring-ab");
  fills(db, 1, 2, 1, 5, 400, "ring-ba");
  // HONESTART: an artist sells one direction to distinct fans — zero reciprocity, whatever the volume.
  fills(db, 2, 3, 4, 6, 900, "sale-one");
  fills(db, 2, 3, 5, 6, 900, "sale-two");

  const rows = await ringCandidates(d1(db));
  assert.equal(rows.length, 1);
  const ring = rows[0]!;
  assert.equal(ring.asset, "RINGCOIN");
  assert.equal(ring.usd, 4000);
  assert.equal(ring.recip_usd, 4000);
  assert.equal(ring.recip_pct, 100);
  assert.equal(ring.recip_fills, 10);
  assert.equal(ring.participants, 2);
  assert.equal(ring.top_pair_usd, 4000);
  assert.equal(ring.top_pair_fills, 10);
  assert.deepEqual([ring.top_pair_a, ring.top_pair_b].sort(), ["ring-a", "ring-b"]);
  db.close();
});

test("already-flagged assets and sub-threshold reciprocity are excluded", async () => {
  const db = harness();
  // FLAGGED rings hard but is already low_quality — the board only shows OPEN review work.
  fills(db, 3, 1, 2, 5, 500, "flagged-ab");
  fills(db, 3, 2, 1, 5, 500, "flagged-ba");
  db.exec(`INSERT INTO asset_signals VALUES(3,1)`);
  // HONESTART has one tiny round-trip inside a real market: 200 reciprocal of 11,000 total (<20%).
  fills(db, 2, 3, 4, 6, 900, "sale-one");
  fills(db, 2, 3, 5, 6, 900, "sale-two");
  fills(db, 2, 4, 3, 4, 25, "swap-back");
  fills(db, 2, 3, 4, 4, 25, "swap-there");

  const rows = await ringCandidates(d1(db));
  assert.deepEqual(rows, []);
  db.close();
});
