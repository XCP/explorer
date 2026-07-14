import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { reputationTierMembers, reputationTop } from "#api/queries/addresses";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact reputation rankings restore address identities", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY,rep_score REAL,survived_assets INTEGER,assets_held INTEGER,dex_trades INTEGER,stamps_created INTEGER,dividends INTEGER,btc_fees REAL,is_exchange INTEGER);
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob'),(3,'exchange');
    INSERT INTO address_signals VALUES(1,12.5,2,3,4,5,6,7,0),(2,8,1,2,3,4,5,6,0),(3,100,9,9,9,9,9,9,1);
  `);
  const binding = d1(db);
  const top = await reputationTop(binding, "rep_score", "is_exchange=0");
  assert.deepEqual(top.map((row) => row.address), ["alice", "bob"]);
  const tier = await reputationTierMembers(binding, "rep_score", "is_exchange=0", 10, 20, 10, 0);
  assert.equal(tier.length, 1);
  assert.equal(tier[0].address, "alice");
  assert.equal(tier[0].raw, 12.5);
});
