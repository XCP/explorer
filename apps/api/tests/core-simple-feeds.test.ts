import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listBroadcasts, listBurns, listDestructions, listDividends, listSweeps } from "#api/queries/records";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact simple record feeds restore address and asset identities", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE sweeps(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,destination_id INTEGER,flags INTEGER,memo TEXT,fee_paid TEXT,status TEXT);
    CREATE TABLE destructions(event_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,asset_id INTEGER,quantity_normalized TEXT,tag TEXT,status TEXT);
    CREATE TABLE burns(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,burned_normalized TEXT,earned_normalized TEXT,status TEXT);
    CREATE TABLE dividends(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,asset_id INTEGER,dividend_asset_id INTEGER,quantity_per_unit_normalized TEXT,status TEXT);
    CREATE TABLE broadcasts(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,timestamp INTEGER,value TEXT,text TEXT,locked INTEGER,mime_type TEXT,status TEXT);
    INSERT INTO address_dictionary VALUES(1,'source'),(2,'destination');
    INSERT INTO asset_dictionary VALUES(1,'CARD'),(2,'XCP');
    INSERT INTO sweeps VALUES(1,zeroblob(32),10,100,1,2,3,'memo','5','valid');
    INSERT INTO destructions VALUES(2,zeroblob(32),11,101,1,1,'2','tag','valid');
    INSERT INTO burns VALUES(3,zeroblob(32),12,102,1,'1.0','1000.0','valid');
    INSERT INTO dividends VALUES(4,zeroblob(32),13,103,1,1,2,'0.5','valid');
    INSERT INTO broadcasts VALUES(5,zeroblob(32),14,104,1,99,'1.25','hello',1,'text/plain','valid');
  `);
  const dbBinding = d1(db);

  assert.deepEqual({ ...(await listSweeps(dbBinding, 1, 0))[0] }, {
    tx_hash: "0".repeat(64),block_index: 10,block_time: 100,source: "source",destination: "destination",
    flags: 3,memo: "memo",fee_paid: "5",status: "valid",
  });
  assert.equal((await listDestructions(dbBinding, 1, 0))[0].asset, "CARD");
  assert.equal((await listBurns(dbBinding, 1, 0))[0].earned_normalized, "1000.0");
  assert.equal((await listDividends(dbBinding, 1, 0))[0].dividend_asset, "XCP");
  assert.deepEqual({ ...(await listBroadcasts(dbBinding, 1, 0))[0] }, {
    tx_hash: "0".repeat(64),block_index: 14,block_time: 104,source: "source",timestamp: 99,
    value: "1.25",text: "hello",locked: 1,mime_type: "text/plain",status: "valid",
  });
});
