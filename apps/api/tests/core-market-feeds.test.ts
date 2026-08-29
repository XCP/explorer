import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  coreDispensersByTx,
  coreDispensesByTx,
  coreDispensesOfDispenser,
  coreDispenserTotals,
  coreParentTxIndex,
  listDispensers,
  listDispenses,
} from "#api/queries/records";

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
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact dispenser feeds restore storefront and valued-sale relationships", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE dispensers(
      tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,
      asset_id INTEGER,give_quantity_normalized TEXT,give_remaining_normalized TEXT,satoshirate TEXT,
      satoshirate_normalized TEXT,dispense_count INTEGER,status INTEGER,escrow_quantity TEXT,closed_block_index INTEGER,oracle_address_id INTEGER
    );
    CREATE TABLE dispenses(
      event_index INTEGER PRIMARY KEY,tx_index INTEGER,dispense_index INTEGER,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,
      destination_id INTEGER,asset_id INTEGER,dispense_quantity_normalized TEXT,dispenser_tx_index INTEGER,
      btc_amount TEXT,dispense_id INTEGER
    );
    CREATE TABLE trades(venue TEXT,ref TEXT,usd_value REAL);
    CREATE TABLE broadcasts(tx_index INTEGER PRIMARY KEY,source_id INTEGER,block_index INTEGER,block_time INTEGER,value TEXT,text TEXT,status TEXT);
    INSERT INTO address_dictionary VALUES(1,'seller'),(2,'buyer'),(3,'oracle');
    INSERT INTO asset_dictionary VALUES(1,'CARD');
    INSERT INTO dispensers VALUES(
      5,x'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',100,1000,1,1,
      '1','8','1000','0.00001000',2,10,'10',101,NULL
    );
    INSERT INTO dispensers VALUES(
      7,x'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',102,1002,1,1,
      '1','1','7000','0.00007000',0,0,'1',NULL,3
    );
    INSERT INTO broadcasts VALUES(1,3,90,900,'50000','BTC-USD','valid'),(2,3,95,950,'69128','BTC-USD','valid'),(3,3,96,960,'1','BTC-USD','invalid');
    INSERT INTO dispenses VALUES(
      9,6,0,x'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',101,1001,1,2,1,'2',5,'2000',77
    );
    INSERT INTO trades VALUES('dispense','77',12.5);
  `);

  const dispensers = (await listDispensers(d1(db), 10, 0)).map((row) => ({ ...row }));
  assert.equal(dispensers[0].oracle_address, "oracle");
  assert.equal(dispensers[0].oracle_price, 69128);
  assert.equal(dispensers[0].oracle_price_block_time, 950);
  assert.equal(dispensers[0].oracle_fiat, "USD");
  assert.equal(dispensers[1].oracle_address, null);
  assert.equal(dispensers[1].oracle_price, null);
  assert.equal(dispensers[1].source, "seller");
  assert.equal(dispensers[1].asset, "CARD");
  assert.equal(dispensers[1].escrow_quantity, "10");
  assert.equal(dispensers[1].closed_block_index, 101);

  const dispenses = (await listDispenses(d1(db), 10, 0)).map((row) => ({ ...row }));
  assert.equal(dispenses[0].source, "seller");
  assert.equal(dispenses[0].destination, "buyer");
  assert.equal(dispenses[0].dispenser_tx_hash, "a".repeat(64));
  assert.equal(dispenses[0].usd_value, 12.5);

  const dispenser = await coreDispensersByTx(d1(db), 5);
  assert.equal(dispenser[0].asset, "CARD");
  const sale = await coreDispensesByTx(d1(db), 6);
  assert.equal(sale[0].dispenser_tx_hash, "a".repeat(64));
  assert.equal(await coreParentTxIndex(d1(db), "dispenses", 6), 5);
  assert.equal((await coreDispensesOfDispenser(d1(db), 5))[0].usd_value, 12.5);
  assert.deepEqual({ ...(await coreDispenserTotals(d1(db), 5)) }, { n: 1, sats: 2000, units: 2 });
});
