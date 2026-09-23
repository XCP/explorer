import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { repairPaymentBridges, selectBridgePrice } from "../ops/lib/payment-bridge-repair.mjs";

test("historical PEPECASH bridge must still agree after shared-payment correction", () => {
  const dex = [
    { price: 1, weight: 10 },
    { price: 1.02, weight: 10 },
  ];
  assert.equal(
    selectBridgePrice("PEPECASH", dex, [
      { price: 1, weight: 10, seller: 1 },
      { price: 1.02, weight: 10, seller: 2 },
    ]),
    1,
  );
  assert.equal(
    selectBridgePrice("PEPECASH", dex, [
      { price: 0.5, weight: 10, seller: 1 },
      { price: 0.51, weight: 10, seller: 2 },
    ]),
    null,
  );
});

test("XCP bridge keeps its existing breadth and dispersion rules", () => {
  assert.equal(
    selectBridgePrice(
      "BITCORN",
      [
        { price: 2, weight: 10, pair: "1:2" },
        { price: 3, weight: 5, pair: "3:4" },
      ],
      [],
    ),
    2,
  );
  assert.equal(
    selectBridgePrice(
      "BITCORN",
      [
        { price: 2, weight: 10, pair: "1:2" },
        { price: 3, weight: 5, pair: "1:2" },
      ],
      [],
    ),
    null,
  );
});

test("bridge repair updates selected prices and withdraws unsupported historical values", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE prices(day TEXT,currency TEXT,usd REAL,source TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER,asset TEXT);
    CREATE TABLE assets(asset_id INTEGER,divisible INTEGER);
    CREATE TABLE order_matches(block_time INTEGER,forward_asset_id INTEGER,backward_asset_id INTEGER,
      forward_quantity TEXT,backward_quantity TEXT,tx0_address_id INTEGER,tx1_address_id INTEGER,status TEXT);
    CREATE TABLE dispenses(block_time INTEGER,source_id INTEGER,asset_id INTEGER,dispense_quantity TEXT,quote_sats REAL);
    CREATE TABLE market_price_observations(day TEXT,base_currency TEXT,quote_currency TEXT,source TEXT,venue TEXT,method TEXT,price REAL);
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'BITCORN'),(3,'PEPECASH');
    INSERT INTO assets VALUES(1,1),(2,1),(3,1);
    INSERT INTO prices VALUES('2026-09-16','XCP',1,'market_vwm'),('2026-09-16','BTC',1,'coinbase'),
      ('2026-09-16','BITCORN',10,'counterparty_dex_bridge'),('2026-09-16','PEPECASH',10,'counterparty_dex_bridge');
    INSERT INTO market_price_observations VALUES
      ('2026-09-16','BITCORN','USD','counterparty','dex','exact_day_bridge_vwm',10),
      ('2026-09-16','PEPECASH','USD','counterparty','dex','exact_day_bridge_vwm',10);
    INSERT INTO order_matches VALUES
      (1789593673,1,2,'200000000','100000000',1,2,'completed'),
      (1789593673,1,2,'300000000','100000000',3,4,'completed'),
      (1789593673,1,3,'100000000','100000000',1,2,'completed'),
      (1789593673,1,3,'100000000','100000000',3,4,'completed');
    INSERT INTO dispenses VALUES(1789593673,1,3,'100000000',50000000),(1789593673,2,3,'100000000',50000000);`);
  repairPaymentBridges((_label: string, sql: string) => db.prepare(sql).all());
  assert.equal(db.prepare("SELECT usd FROM prices WHERE currency='BITCORN'").get()?.usd, 2);
  assert.equal(db.prepare("SELECT price FROM market_price_observations WHERE base_currency='BITCORN'").get()?.price, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM prices WHERE currency='PEPECASH'").get()?.n, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM market_price_observations WHERE base_currency='PEPECASH'").get()?.n,
    0,
  );
  assert.equal(db.prepare("SELECT usd FROM prices WHERE currency='XCP'").get()?.usd, 1);
  db.close();
});
