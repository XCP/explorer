import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { coreContextRecordsByTx, listIssuances, listTransactions } from "#api/queries/records";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
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

test("compact transaction and issuance feeds restore public identities", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE transactions(
      tx_index INTEGER PRIMARY KEY,tx_hash BLOB,block_index INTEGER,block_time INTEGER,source_id INTEGER,
      destination_id INTEGER,btc_amount TEXT,fee TEXT,supported INTEGER
    );
    CREATE TABLE issuances(
      event_index INTEGER PRIMARY KEY,tx_index INTEGER,msg_index INTEGER,tx_hash BLOB,block_index INTEGER,block_time INTEGER,asset_id INTEGER,
      asset_longname TEXT,source_id INTEGER,issuer_id INTEGER,quantity_normalized TEXT,transfer INTEGER,
      divisible INTEGER,locked INTEGER,description TEXT,asset_events TEXT,status TEXT
    );
    INSERT INTO address_dictionary VALUES(1,'source'),(2,'destination'),(3,'issuer');
    INSERT INTO asset_dictionary VALUES(1,'CARD');
    INSERT INTO transactions VALUES(
      8,x'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',100,1000,1,2,'25','5',1
    );
    INSERT INTO issuances VALUES(
      9,18,0,x'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',101,1001,1,
      'PARENT.CARD',1,3,'1',0,0,1,'description','["lock"]','valid'
    );
  `);

  const transactions = (await listTransactions(d1(db), 10, 0)).map((row) => ({ ...row }));
  assert.deepEqual(transactions, [{
    tx_hash: "a".repeat(64),tx_index: 8,block_index: 100,block_time: 1000,source: "source",
    destination: "destination",btc_amount: "25",fee: "5",supported: 1,
  }]);

  const issuances = (await listIssuances(d1(db), 10, 0)).map((row) => ({ ...row }));
  assert.equal(issuances[0].tx_hash, "b".repeat(64));
  assert.equal(issuances[0].asset, "CARD");
  assert.equal(issuances[0].asset_longname, "PARENT.CARD");
  assert.equal(issuances[0].source, "source");
  assert.equal(issuances[0].issuer, "issuer");
  assert.equal(issuances[0].asset_events, '["lock"]');
  assert.equal((await coreContextRecordsByTx(d1(db), "issuances", 18))[0].asset_longname, "PARENT.CARD");
});
