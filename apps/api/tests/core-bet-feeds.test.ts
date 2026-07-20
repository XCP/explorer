import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listBetMatches, listBtcpays, listBets } from "#api/queries/records";

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
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact BTC pay and bet feeds restore composite identities", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE order_matches(tx0_index INTEGER,tx1_index INTEGER,tx0_hash BLOB,tx1_hash BLOB,PRIMARY KEY(tx0_index,tx1_index));
    CREATE TABLE btcpays(event_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,destination_id INTEGER,order_match_tx0_index INTEGER,order_match_tx1_index INTEGER,btc_amount_normalized TEXT,status TEXT);
    CREATE TABLE bets(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,feed_address_id INTEGER,bet_type INTEGER,deadline INTEGER,wager_quantity TEXT,counterwager_quantity TEXT,target_value TEXT,leverage INTEGER,status TEXT);
    CREATE TABLE bet_matches(tx0_index INTEGER,tx1_index INTEGER,tx0_hash BLOB,tx1_hash BLOB,tx0_address_id INTEGER,tx1_address_id INTEGER,feed_address_id INTEGER,forward_quantity TEXT,backward_quantity TEXT,block_index INTEGER,block_time INTEGER,status TEXT,PRIMARY KEY(tx0_index,tx1_index));
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob'),(3,'feed');
    INSERT INTO order_matches VALUES(10,11,zeroblob(32),X'1111111111111111111111111111111111111111111111111111111111111111');
    INSERT INTO btcpays VALUES(1,X'2222222222222222222222222222222222222222222222222222222222222222',20,100,1,2,10,11,'0.1','valid');
    INSERT INTO bets VALUES(12,X'3333333333333333333333333333333333333333333333333333333333333333',21,101,1,3,0,200,'5','10','1.5',5040,'open');
    INSERT INTO bet_matches VALUES(12,13,X'3333333333333333333333333333333333333333333333333333333333333333',X'4444444444444444444444444444444444444444444444444444444444444444',1,2,3,'5','10',22,102,'pending');
  `);
  const binding = d1(db);
  const pay = (await listBtcpays(binding, 1, 0))[0];
  assert.equal(pay.order_match_id, `${"0".repeat(64)}_${"1".repeat(64)}`);
  assert.equal(pay.source, "alice");
  const bet = (await listBets(binding, 1, 0))[0];
  assert.equal(bet.feed_address, "feed");
  assert.equal(bet.leverage, 5040);
  const match = (await listBetMatches(binding, 1, 0))[0];
  assert.equal(match.id, `${"3".repeat(64)}_${"4".repeat(64)}`);
  assert.equal(match.tx1_address, "bob");
});
