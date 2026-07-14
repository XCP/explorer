import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listPoolMatches, listPools, listRps, listRpsMatches } from "#api/queries/records";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact RPS and pool feeds restore identities after pagination", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE rps(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,possible_moves INTEGER,wager TEXT,expiration INTEGER,status TEXT);
    CREATE TABLE rps_matches(tx0_index INTEGER,tx1_index INTEGER,tx0_hash BLOB,tx1_hash BLOB,tx0_address_id INTEGER,tx1_address_id INTEGER,possible_moves INTEGER,wager TEXT,block_index INTEGER,block_time INTEGER,status TEXT,PRIMARY KEY(tx0_index,tx1_index));
    CREATE TABLE pools(asset_a_id INTEGER,asset_b_id INTEGER,lp_asset TEXT,pair TEXT,reserve_a TEXT,reserve_b TEXT,lp_supply TEXT,price REAL,status TEXT,block_index INTEGER,PRIMARY KEY(asset_a_id,asset_b_id));
    CREATE TABLE pool_matches(event_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,lp_asset TEXT,pair TEXT,forward_asset_id INTEGER,forward_quantity TEXT,backward_asset_id INTEGER,backward_quantity TEXT,fee_quantity TEXT,fee_bps INTEGER);
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob');
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'TOKEN');
    INSERT INTO rps VALUES(1,X'1111111111111111111111111111111111111111111111111111111111111111',10,100,1,5,'100',20,'open');
    INSERT INTO rps_matches VALUES(1,2,X'1111111111111111111111111111111111111111111111111111111111111111',X'2222222222222222222222222222222222222222222222222222222222222222',1,2,5,'100',11,101,'pending');
    INSERT INTO pools VALUES(1,2,'XCP-TOKEN','XCP/TOKEN','10','20','5',2.0,'open',12);
    INSERT INTO pool_matches VALUES(3,X'3333333333333333333333333333333333333333333333333333333333333333',13,102,1,'XCP-TOKEN','XCP/TOKEN',1,'1',2,'2','0.01',30);
  `);
  const binding = d1(db);
  assert.equal((await listRps(binding, 1, 0))[0].source, "alice");
  assert.equal((await listRpsMatches(binding, 1, 0))[0].id, `${"1".repeat(64)}_${"2".repeat(64)}`);
  assert.deepEqual({ ...(await listPools(binding, 1, 0))[0] }, {
    lp_asset: "XCP-TOKEN",pair: "XCP/TOKEN",asset_a: "XCP",asset_b: "TOKEN",reserve_a: "10",
    reserve_b: "20",lp_supply: "5",price: 2,status: "open",block_index: 12,
  });
  const match = (await listPoolMatches(binding, 1, 0))[0];
  assert.equal(match.forward_asset, "XCP");
  assert.equal(match.backward_asset, "TOKEN");
  assert.equal(match.source, "alice");
});
