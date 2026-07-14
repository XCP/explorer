import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { exchangeSummary, exchangeTopAssets, exchangeWallets } from "#api/queries/exchanges";

class Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind() { return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all() as T[] }; }
  async first<T>() { return (this.db.prepare(this.sql).get() as T | undefined) ?? null; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact exchange reads use the newest complete generation and restore identities", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY,assets_received INTEGER,in_peers INTEGER,first_block INTEGER,last_block INTEGER,is_exchange INTEGER,is_deposit INTEGER);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,asset_longname TEXT);
    CREATE TABLE exchange_top_assets(generation INTEGER,asset_id INTEGER,depositors INTEGER,PRIMARY KEY(generation,asset_id));
    INSERT INTO address_dictionary VALUES(1,'exchange'),(2,'deposit');
    INSERT INTO asset_dictionary VALUES(1,'OLD'),(2,'CARD');
    INSERT INTO address_signals VALUES(1,10,5,100,200,1,0),(2,0,0,101,201,0,1);
    INSERT INTO assets VALUES(2,'PARENT.CARD');
    INSERT INTO exchange_top_assets VALUES(1,1,99),(2,2,7);
  `);
  const binding = d1(db);
  assert.equal((await exchangeWallets(binding))[0].address, "exchange");
  assert.deepEqual({ ...(await exchangeTopAssets(binding))[0] }, {
    asset: "CARD",asset_longname: "PARENT.CARD",depositors: 7,
  });
  assert.deepEqual({ ...(await exchangeSummary(binding))! }, { exchanges: 1,deposit_addresses: 1 });
});
