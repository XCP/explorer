import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  SCARCE_TRADES_SQL,
  DISPENSE_TRADE_LEGS_SQL,
  DISPENSE_TRADES_SQL,
  coreDexTradesSql,
  emblemTradesSql,
} from "#api/indexer/trades";
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

test("compact venue builders preserve canonical identities and bundled Emblem sales", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,divisible INTEGER);
    CREATE TABLE order_matches(
      tx0_hash BLOB,tx1_hash BLOB,tx0_address_id INTEGER,tx1_address_id INTEGER,
      forward_asset_id INTEGER,forward_quantity TEXT,backward_asset_id INTEGER,backward_quantity TEXT,
      block_index INTEGER,block_time INTEGER,status TEXT);
    CREATE TABLE transactions(tx_index INTEGER PRIMARY KEY,tx_hash BLOB);
    CREATE TABLE transaction_outputs(
      tx_index INTEGER,out_index INTEGER,block_index INTEGER,destination_id INTEGER,btc_amount TEXT);
    CREATE TABLE dispenses(
      event_index INTEGER,tx_index INTEGER,dispense_index INTEGER,asset_id INTEGER,block_time INTEGER,block_index INTEGER,
      dispense_quantity_normalized TEXT,btc_amount TEXT,destination_id INTEGER,source_id INTEGER,tx_hash BLOB);
    CREATE TABLE emblem_sales(
      tx_hash TEXT,log_index INTEGER,contract_id INTEGER,token_id TEXT,price_raw TEXT,
      token_address_id INTEGER,buyer_id INTEGER,seller_id INTEGER,block_number INTEGER);
    CREATE TABLE ethereum_blocks(block_number INTEGER PRIMARY KEY,block_time INTEGER);
    CREATE TABLE emblem_vaults(
      token_id TEXT,contract_id INTEGER,contents_asset_id INTEGER,contents_qty REAL,vault_kind TEXT,
      cracked_at INTEGER,is_scam_shell INTEGER,btc_address_id INTEGER,is_dump INTEGER DEFAULT 0);
    CREATE TABLE scarce_city_sales(asset_id INTEGER,sold_at INTEGER,price_btc REAL);
    CREATE TABLE trades(
      venue TEXT,ref TEXT,asset_id INTEGER,block_time INTEGER,block_index INTEGER,quantity REAL,
      currency TEXT,total REAL,price REAL GENERATED ALWAYS AS (total/quantity) VIRTUAL,usd_value REAL,
      buyer_id INTEGER,seller_id INTEGER,tx_hash BLOB,external_tx_hash TEXT,sale_class TEXT,
      PRIMARY KEY(venue,ref));
    CREATE TABLE trade_legs(
      venue TEXT,trade_ref TEXT,leg_index INTEGER,asset_id INTEGER,quantity REAL,
      PRIMARY KEY(venue,trade_ref,leg_index));
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'BTC'),(3,'CARD'),(4,'OTHER');
    INSERT INTO assets VALUES(3,0);
    INSERT INTO address_dictionary VALUES
      (1,'buyer'),(2,'seller'),(3,'0xcontract'),(4,'eth'),(5,'btc-vault');
    INSERT INTO order_matches VALUES(
      x'${"11".repeat(32)}',x'${"22".repeat(32)}',1,2,1,'100000000',3,'2',100,1000,'completed');
    INSERT INTO transactions VALUES(9,x'${"33".repeat(32)}');
    INSERT INTO transaction_outputs VALUES(9,0,101,2,'50000000');
    INSERT INTO dispenses VALUES(77,9,0,3,1001,101,'4','50000000',1,2,x'${"33".repeat(32)}');
    INSERT INTO transactions VALUES(10,x'${"44".repeat(32)}');
    INSERT INTO transaction_outputs VALUES(10,1,102,2,'60000000');
    INSERT INTO dispenses VALUES
      (78,10,0,3,1002,102,'1','60000000',1,2,x'${"44".repeat(32)}'),
      (79,10,1,4,1002,102,'2','60000000',1,2,x'${"44".repeat(32)}');
    INSERT INTO transactions VALUES(11,x'${"55".repeat(32)}');
    INSERT INTO dispenses VALUES
      (80,11,0,3,1003,103,'3','70000000',1,2,x'${"55".repeat(32)}'),
      (81,11,1,4,1003,103,'5','70000000',1,2,x'${"55".repeat(32)}');
    INSERT INTO emblem_sales VALUES
      ('0xeth',9,3,'7','1000000000000000000',4,1,2,16000000),
      ('0xeth',9,3,'8','2000000000000000000',4,1,2,16000000),
      ('0xeth',9,3,'9','3000000000000000000',4,1,2,16000000);
    INSERT INTO ethereum_blocks VALUES(16000000,1668770000);
    INSERT INTO emblem_vaults VALUES
      ('7',3,3,1,'single',NULL,0,5,0),('8',3,3,1,'single',NULL,0,5,0),
      ('9',3,3,1,'single',NULL,0,5,1);
    INSERT INTO scarce_city_sales VALUES(3,2000,0.25);
  `);
  db.prepare(coreDexTradesSql()).run(0, 200);
  db.prepare(DISPENSE_TRADES_SQL).run(0, 200);
  db.prepare(DISPENSE_TRADE_LEGS_SQL).run(0, 200);
  db.prepare(emblemTradesSql("")).run();
  db.prepare(SCARCE_TRADES_SQL).run();
  assert.equal(db.prepare(coreDexTradesSql()).run(0, 200).changes, 0);
  assert.equal(db.prepare(DISPENSE_TRADES_SQL).run(0, 200).changes, 0);
  assert.equal(db.prepare(DISPENSE_TRADE_LEGS_SQL).run(0, 200).changes, 0);
  assert.equal(db.prepare(emblemTradesSql("")).run().changes, 0);
  assert.equal(db.prepare(SCARCE_TRADES_SQL).run().changes, 0);
  assert.deepEqual(
    { ...db.prepare(`SELECT asset_id,sale_class FROM trades WHERE venue='emblem' AND ref LIKE '%_9'`).get() },
    { asset_id: null, sale_class: "scam_dump" },
  );
  assert.deepEqual(
    db
      .prepare(`SELECT venue,ref,asset_id,quantity,currency,total FROM trades ORDER BY venue,ref`)
      .all()
      .map((row) => ({ ...row })),
    [
      {
        venue: "dex",
        ref: `${"11".repeat(32)}${"22".repeat(32)}`,
        asset_id: 3,
        quantity: 2,
        currency: "XCP",
        total: 1,
      },
      { venue: "dispense", ref: `${"33".repeat(32)}:0`, asset_id: 3, quantity: 4, currency: "BTC", total: 0.5 },
      {
        venue: "dispense",
        ref: `${"44".repeat(32)}:1`,
        asset_id: null,
        quantity: null,
        currency: "BTC",
        total: 0.6,
      },
      {
        venue: "dispense",
        ref: `${"55".repeat(32)}:e80`,
        asset_id: null,
        quantity: null,
        currency: "BTC",
        total: 0.7,
      },
      { venue: "emblem", ref: "0xeth_9_0xcontract_7", asset_id: 3, quantity: 1, currency: "ETH", total: 1 },
      { venue: "emblem", ref: "0xeth_9_0xcontract_8", asset_id: 3, quantity: 1, currency: "ETH", total: 2 },
      { venue: "emblem", ref: "0xeth_9_0xcontract_9", asset_id: null, quantity: 1, currency: "ETH", total: 3 },
      { venue: "scarce.city", ref: "CARD_2000", asset_id: 3, quantity: 1, currency: "BTC", total: 0.25 },
    ],
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT leg_index,asset_id,quantity FROM trade_legs
         WHERE venue='dispense' AND trade_ref=? ORDER BY leg_index`,
      )
      .all(`${"44".repeat(32)}:1`)
      .map((row) => ({ ...row })),
    [
      { leg_index: 0, asset_id: 3, quantity: 1 },
      { leg_index: 1, asset_id: 4, quantity: 2 },
    ],
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT leg_index,asset_id,quantity FROM trade_legs
         WHERE venue='dispense' AND trade_ref=? ORDER BY leg_index`,
      )
      .all(`${"55".repeat(32)}:e80`)
      .map((row) => ({ ...row })),
    [
      { leg_index: 0, asset_id: 3, quantity: 3 },
      { leg_index: 1, asset_id: 4, quantity: 5 },
    ],
  );
  // A vault can be classified as a dump after its sales were first projected.
  // Reconciliation must remove the asset attribution instead of preserving stale
  // buyers, volume, and Rating evidence.
  db.prepare(`UPDATE emblem_vaults SET is_dump=1 WHERE token_id='7' AND contract_id=3`).run();
  db.prepare(emblemTradesSql("AND sale.contract_id=3 AND sale.token_id='7'")).run();
  assert.deepEqual(
    { ...db.prepare(`SELECT asset_id,sale_class FROM trades WHERE venue='emblem' AND ref LIKE '%_7'`).get() },
    { asset_id: null, sale_class: "scam_dump" },
  );
});

test("trade identity migration replaces source-local and lossy references", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE dispenses(event_index INTEGER,dispense_id INTEGER);
    CREATE TABLE emblem_sales(tx_hash TEXT,log_index INTEGER,contract_id INTEGER,token_id TEXT);
    CREATE TABLE trades(venue TEXT,ref TEXT,asset_id INTEGER,PRIMARY KEY(venue,ref));
    INSERT INTO address_dictionary VALUES(3,'0xcontract');
    INSERT INTO dispenses VALUES(77,9001);
    INSERT INTO emblem_sales VALUES('0xeth',9,3,'7'),('0xeth',9,3,'8');
    INSERT INTO trades(venue,ref) VALUES('dispense','9001'),('emblem','0xeth_9');
  `);
  db.exec(readFileSync("migrations-core/0020_trade_identities.sql", "utf8"));
  assert.deepEqual(
    db
      .prepare(`SELECT venue,ref FROM trades ORDER BY venue`)
      .all()
      .map((row) => ({ ...row })),
    [
      { venue: "dispense", ref: "77" },
      { venue: "emblem", ref: "0xeth_9_0xcontract_7" },
    ],
  );
});
