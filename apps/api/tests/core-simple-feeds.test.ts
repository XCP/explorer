import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  listBroadcasts,
  listBurns,
  listDestructions,
  listDividends,
  listFairminters,
  listFairmints,
  listSweeps,
  coreStatelessRecordsByTx,
  coreContextRecordsByTx,
} from "#api/queries/records";

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
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,divisible INTEGER);
    CREATE TABLE fairminters(tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,asset_id INTEGER,asset_longname TEXT,price TEXT,quantity_by_price TEXT,hard_cap TEXT,soft_cap TEXT,pool_quantity TEXT,lp_asset TEXT,divisible INTEGER,earned_quantity TEXT,paid_quantity TEXT,status TEXT);
    CREATE TABLE fairmints(event_index INTEGER PRIMARY KEY,tx_index INTEGER,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,fairminter_tx_index INTEGER,asset_id INTEGER,earn_quantity TEXT,paid_quantity TEXT,status TEXT);
    INSERT INTO address_dictionary VALUES(1,'source'),(2,'destination');
    INSERT INTO asset_dictionary VALUES(1,'CARD'),(2,'XCP');
    INSERT INTO sweeps VALUES(1,zeroblob(32),10,100,1,2,3,'memo','5','valid');
    INSERT INTO destructions VALUES(2,zeroblob(32),11,101,1,1,'2','tag','valid');
    INSERT INTO burns VALUES(3,zeroblob(32),12,102,1,'1.0','1000.0','valid');
    INSERT INTO dividends VALUES(4,zeroblob(32),13,103,1,1,2,'0.5','valid');
    INSERT INTO broadcasts VALUES(5,zeroblob(32),14,104,1,99,'1.25','hello',1,'text/plain','valid');
    INSERT INTO assets VALUES(1,1);
    INSERT INTO fairminters VALUES(6,zeroblob(32),15,105,1,1,'PARENT.CARD','10','2','100','50','20','CARD-XCP',1,'40','200','open');
    INSERT INTO fairmints VALUES(7,17,zeroblob(32),16,106,2,6,1,'2','10','valid');
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
  assert.equal((await coreStatelessRecordsByTx(dbBinding, "sweeps", 1))[0].destination, "destination");
  assert.equal((await coreStatelessRecordsByTx(dbBinding, "burns", 3))[0].burned_normalized, "1.0");
  assert.equal((await coreStatelessRecordsByTx(dbBinding, "dividends", 4))[0].asset, "CARD");
  assert.equal((await coreStatelessRecordsByTx(dbBinding, "broadcasts", 5))[0].text, "hello");
  assert.equal((await listFairminters(dbBinding, 1, 0))[0].asset_longname, "PARENT.CARD");
  assert.equal((await coreContextRecordsByTx(dbBinding, "fairminters", 6))[0].asset, "CARD");
  assert.equal((await coreContextRecordsByTx(dbBinding, "fairmints", 17))[0].fairminter_tx_hash, "0".repeat(64));
  assert.deepEqual({ ...(await listFairmints(dbBinding, 1, 0))[0] }, {
    tx_hash: "0".repeat(64),block_index: 16,block_time: 106,source: "destination",
    fairminter_tx_hash: "0".repeat(64),asset: "CARD",earn_quantity: "2",paid_quantity: "10",
    divisible: 1,status: "valid",
  });
});
