import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listDispensers, listDispenses, listIssuances, listIssued } from "#api/queries/addresses";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact address tabs deduplicate both-sided relationships and restore identities", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE issuances(event_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,issuer_id INTEGER,asset_id INTEGER,asset_longname TEXT,quantity_normalized TEXT,transfer INTEGER,description TEXT,asset_events TEXT,status TEXT);
    CREATE TABLE dispensers(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,asset_id INTEGER,give_quantity_normalized TEXT,give_remaining_normalized TEXT,satoshirate TEXT,satoshirate_normalized TEXT,dispense_count INTEGER,status INTEGER);
    CREATE TABLE dispenses(event_index INTEGER PRIMARY KEY,dispense_id INTEGER,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,destination_id INTEGER,asset_id INTEGER,dispense_quantity_normalized TEXT,dispenser_tx_index INTEGER,btc_amount TEXT);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,asset_longname TEXT,divisible INTEGER,locked INTEGER,issuer_id INTEGER,owner_id INTEGER,first_issuance_block_index INTEGER);
    CREATE TABLE trades(venue TEXT,ref TEXT,usd_value REAL,PRIMARY KEY(venue,ref));
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob');
    INSERT INTO asset_dictionary VALUES(1,'CARD');
    INSERT INTO issuances VALUES(1,zeroblob(32),10,100,1,1,1,NULL,'1',0,'art','creation','valid');
    INSERT INTO dispensers VALUES(2,X'1111111111111111111111111111111111111111111111111111111111111111',11,101,1,1,'5','4','1000','0.00001',1,0);
    INSERT INTO dispenses VALUES(3,99,X'2222222222222222222222222222222222222222222222222222222222222222',12,102,1,1,1,'1',2,'1000');
    INSERT INTO assets VALUES(1,NULL,0,1,1,1,10);
    INSERT INTO trades VALUES('dispense','99',25.5);
  `);
  const binding = d1(db);
  assert.equal((await listIssuances(binding, "alice", { limit: 10, offset: 0 })).length, 1);
  assert.equal((await listDispensers(binding, "alice", { limit: 10, offset: 0 }))[0].asset, "CARD");
  const dispenses = await listDispenses(binding, "alice", { limit: 10, offset: 0 });
  assert.equal(dispenses.length, 1);
  assert.equal(dispenses[0].dispenser_tx_hash, "1".repeat(64));
  assert.equal(dispenses[0].usd_value, 25.5);
  const issued = await listIssued(binding, "alice", { limit: 10, offset: 0 });
  assert.equal(issued.length, 1);
  assert.equal(issued[0].issuer, "alice");
});
