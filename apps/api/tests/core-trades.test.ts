import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listTrades, tradeVenueStats } from "#api/queries/trades";

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

function d1(db: DatabaseSync): D1Database {
  return { prepare: (sql: string) => new Statement(db, sql) } as unknown as D1Database;
}

test("compact trades restore public identities, filters, and venue totals", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE trades(
      venue TEXT,ref TEXT,asset_id INTEGER,block_time INTEGER,block_index INTEGER,quantity REAL,
      currency TEXT,total REAL,price REAL GENERATED ALWAYS AS (total/quantity) VIRTUAL,usd_value REAL,
      buyer_id INTEGER,seller_id INTEGER,tx_hash BLOB,external_tx_hash TEXT,PRIMARY KEY(venue,ref)
    );
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'RAREPEPE');
    INSERT INTO address_dictionary VALUES(1,'buyer'),(2,'seller');
    INSERT INTO trades(venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,buyer_id,seller_id,tx_hash)
      VALUES('dispense','1',1,20,10,2,'BTC',0.5,30000,1,2,x'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    INSERT INTO trades(venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,external_tx_hash)
      VALUES('emblem','2',2,10,9,1,'ETH',3,6000,'ethereum-hash');
  `);

  const rows = (await listTrades(d1(db), { asset: "xcp", limit: 10, offset: 0 })).map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    {
      venue: "dispense",
      asset: "XCP",
      block_time: 20,
      block_index: 10,
      quantity: 2,
      currency: "BTC",
      total: 0.5,
      price: 0.25,
      usd_value: 30000,
      buyer: "buyer",
      seller: "seller",
      tx_hash: "a".repeat(64),
    },
  ]);
  assert.deepEqual(
    (await tradeVenueStats(d1(db))).map((row) => ({ ...row })),
    [
      { venue: "dispense", trades: 1, assets: 1, last_time: 20, usd_known: 30000 },
      { venue: "emblem", trades: 1, assets: 1, last_time: 10, usd_known: 6000 },
    ],
  );
});
