import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { APPLY_TRADE_USD_SQL, BUILD_XCP_BTC_DAILY_SQL, BUILD_XCP_USD_SQL } from "#api/indexer/prices";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE order_matches(
      forward_asset_id INTEGER,forward_quantity TEXT,backward_asset_id INTEGER,backward_quantity TEXT,
      block_time INTEGER,status TEXT);
    CREATE TABLE xcp_btc_daily(
      day TEXT PRIMARY KEY,xcpbtc REAL,volume_xcp TEXT,trades INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE prices(
      day TEXT,currency TEXT,usd REAL,source TEXT,observed_day TEXT,fidelity INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day,currency));
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'BTC');
    INSERT INTO order_matches VALUES
      (1,'10000000000',2,'10000000',strftime('%s','2026-01-01'),'completed'),
      (1,'10000000000',2,'20000000',strftime('%s','2026-01-01'),'completed'),
      (1,'100000000',2,'100000000',strftime('%s','2026-01-01'),'completed'),
      (1,'100000000',2,'100000000',strftime('%s','2026-01-02'),'pending');
    INSERT INTO prices VALUES
      ('2026-01-01','BTC',100000,'coinbase','2026-01-01',3),
      ('2026-01-08','BTC',110000,'coinbase','2026-01-08',3),
      ('2026-01-09','BTC',120000,'coinbase','2026-01-09',3);
  `);
  return db;
}

test("XCP pricing uses completed-trade volume-weighted medians", () => {
  const db = fixture();
  db.exec(BUILD_XCP_BTC_DAILY_SQL);
  const row = db.prepare(`SELECT * FROM xcp_btc_daily`).get() as Record<string, unknown>;
  assert.equal(row.day, "2026-01-01");
  assert.equal(row.xcpbtc, 0.002);
  assert.equal(row.volume_xcp, "20100000000");
  assert.equal(row.trades, 3);
  db.close();
});

test("derived XCP/USD expires after seven days and records provenance", () => {
  const db = fixture();
  db.exec(BUILD_XCP_BTC_DAILY_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  assert.deepEqual(
    db
      .prepare(`SELECT day,usd,source,observed_day,fidelity FROM prices WHERE currency='XCP' ORDER BY day`)
      .all()
      .map((row) => ({ ...row })),
    [
      { day: "2026-01-01", usd: 200, source: "dex_vwm", observed_day: "2026-01-01", fidelity: 1 },
      { day: "2026-01-08", usd: 220, source: "dex_vwm", observed_day: "2026-01-01", fidelity: 1 },
    ],
  );
  db.close();
});

test("a higher-fidelity observed price wins over a derived price", () => {
  const db = fixture();
  db.exec(BUILD_XCP_BTC_DAILY_SQL);
  db.exec(`INSERT INTO prices VALUES('2026-01-01','XCP',250,'market','2026-01-01',3)`);
  db.exec(BUILD_XCP_USD_SQL);
  assert.deepEqual(
    { ...db.prepare(`SELECT usd,source,fidelity FROM prices WHERE day='2026-01-01' AND currency='XCP'`).get() },
    { usd: 250, source: "market", fidelity: 3 },
  );
  db.close();
});

test("trade USD reconciliation clears expired derivations without touching direct USD sales", () => {
  const db = fixture();
  db.exec(BUILD_XCP_BTC_DAILY_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(`
    CREATE TABLE trades(block_time INTEGER,currency TEXT,total REAL,usd_value REAL);
    INSERT INTO trades VALUES
      (strftime('%s','2026-01-01'),'XCP',2,NULL),
      (strftime('%s','2026-01-09'),'XCP',2,999),
      (strftime('%s','2026-01-09'),'USDC',2,2);
  `);
  db.prepare(APPLY_TRADE_USD_SQL).run(0, 3);
  assert.deepEqual(
    db
      .prepare(`SELECT currency,usd_value FROM trades ORDER BY rowid`)
      .all()
      .map((row) => ({ ...row })),
    [
      { currency: "XCP", usd_value: 400 },
      { currency: "XCP", usd_value: null },
      { currency: "USDC", usd_value: 2 },
    ],
  );
  db.close();
});
