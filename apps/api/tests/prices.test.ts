import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  APPLY_TRADE_USD_SQL,
  BUILD_BURN_PRICE_OBSERVATIONS_SQL,
  BUILD_BURN_XCP_USD_SQL,
  BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL,
  BUILD_OBSERVED_USD_SQL,
  BUILD_XCP_USD_SQL,
  PRUNE_COUNTERPARTY_PRICE_OBSERVATIONS_SQL,
  PRUNE_BURN_PRICE_OBSERVATIONS_SQL,
  PRUNE_BURN_XCP_USD_SQL,
  PRUNE_OBSERVED_USD_SQL,
  PRUNE_XCP_USD_SQL,
  tradeUsdWindow,
} from "#api/indexer/prices";

test("USD reconciliation advances new rows without wrapping when caught up", () => {
  assert.deepEqual(tradeUsdWindow(10, 20), { from: 10, to: 20 });
  assert.deepEqual(tradeUsdWindow(10, 300_020), { from: 10, to: 200_010 });
  assert.equal(tradeUsdWindow(20, 20), null);
  assert.equal(tradeUsdWindow(21, 20), null);
});

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE order_matches(
      forward_asset_id INTEGER,forward_quantity TEXT,backward_asset_id INTEGER,backward_quantity TEXT,
      block_time INTEGER,status TEXT);
    CREATE TABLE burns(block_time INTEGER,burned TEXT,earned TEXT,status TEXT);
    CREATE TABLE market_price_observations(
      day TEXT,base_currency TEXT,quote_currency TEXT,source TEXT,venue TEXT,price REAL,
      volume_base REAL,trades INTEGER,first_time INTEGER,last_time INTEGER,method TEXT,
      PRIMARY KEY(day,base_currency,quote_currency,source,venue));
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

test("genesis burns materialize as protocol conversions rather than trades", () => {
  const db = fixture();
  db.exec(`INSERT INTO burns VALUES
    (strftime('%s','2014-01-02'),'100000000','100000000000','valid'),
    (strftime('%s','2014-01-02'),'200000000','100000000000','valid'),
    (strftime('%s','2014-01-02'),'900000000','100000000','invalid')`);
  db.exec(BUILD_BURN_PRICE_OBSERVATIONS_SQL);
  assert.deepEqual(
    { ...db.prepare(`SELECT day,source,venue,price,volume_base,trades,method FROM market_price_observations`).get() },
    { day: "2014-01-02", source: "counterparty", venue: "burn", price: 0.001,
      volume_base: 2000, trades: 2, method: "protocol_conversion_vwm" },
  );
  const changes = Number(db.prepare(`SELECT total_changes() n`).get()?.n);
  db.exec(BUILD_BURN_PRICE_OBSERVATIONS_SQL);
  assert.equal(Number(db.prepare(`SELECT total_changes() n`).get()?.n), changes);
  db.exec(`UPDATE burns SET status='invalid'`);
  db.exec(PRUNE_BURN_PRICE_OBSERVATIONS_SQL);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM market_price_observations`).get()?.n, 0);
  db.close();
});

test("genesis XCP/USD is reproducibly derived from the burn conversion and same-day BTC/USD", () => {
  const db = fixture();
  db.exec(`
    INSERT INTO prices VALUES('2014-01-02','BTC',800,'coinmarketcap_aggregate','2014-01-02',2);
    INSERT INTO prices VALUES('2014-01-02','XCP',9,'coinmarketcap_archive','2014-01-02',0);
    INSERT INTO market_price_observations VALUES(
      '2014-01-02','XCP','BTC','counterparty','burn',0.001,1000,2,NULL,NULL,'protocol_conversion_vwm');
  `);
  db.exec(BUILD_BURN_XCP_USD_SQL);
  assert.deepEqual(
    { ...db.prepare(`SELECT usd,source,observed_day,fidelity FROM prices WHERE day='2014-01-02' AND currency='XCP'`).get() },
    { usd: 0.8, source: "burn_vwm", observed_day: "2014-01-02", fidelity: 1 },
  );
  db.exec(`DELETE FROM market_price_observations WHERE venue='burn'`);
  db.exec(PRUNE_BURN_XCP_USD_SQL);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM prices WHERE source='burn_vwm'`).get()?.n, 0);
  db.close();
});

test("XCP pricing uses completed-trade volume-weighted medians", () => {
  const db = fixture();
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  const row = db.prepare(`SELECT * FROM market_price_observations`).get() as Record<string, unknown>;
  assert.equal(row.day, "2026-01-01");
  assert.equal(row.source, "counterparty");
  assert.equal(row.venue, "dex");
  assert.equal(row.price, 0.002);
  assert.equal(row.volume_base, 201);
  assert.equal(row.trades, 3);
  db.close();
});

test("XCP/BTC materialization is idempotent and prunes only obsolete source days", () => {
  const db = fixture();
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  const beforeReplay = Number(db.prepare(`SELECT total_changes() n`).get()?.n);
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  assert.equal(Number(db.prepare(`SELECT total_changes() n`).get()?.n) - beforeReplay, 0);

  db.exec(`INSERT INTO market_price_observations VALUES(
    '2025-12-31','XCP','BTC','counterparty','dex',9,1,1,NULL,NULL,'volume_weighted_median')`);
  db.exec(PRUNE_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  assert.deepEqual(
    db.prepare(`SELECT day FROM market_price_observations ORDER BY day`).all().map((row) => row.day),
    ["2026-01-01"],
  );

  db.exec(`UPDATE order_matches SET backward_quantity='30000000' WHERE rowid=2`);
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  assert.equal(db.prepare(`SELECT price FROM market_price_observations WHERE day='2026-01-01'`).get()?.price, 0.003);
  db.close();
});

test("derived XCP/USD expires after seven days and records provenance", () => {
  const db = fixture();
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
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
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  db.exec(`INSERT INTO prices VALUES('2026-01-01','XCP',250,'market','2026-01-01',3)`);
  db.exec(BUILD_XCP_USD_SQL);
  assert.deepEqual(
    { ...db.prepare(`SELECT usd,source,fidelity FROM prices WHERE day='2026-01-01' AND currency='XCP'`).get() },
    { usd: 250, source: "market", fidelity: 3 },
  );
  db.close();
});

test("observed aggregate XCP/USD outranks the derived cross-rate and reconciles by provenance", () => {
  const db = fixture();
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(`INSERT INTO market_price_observations VALUES(
    '2026-01-01','XCP','USD','coinmarketcap','aggregate',250,0,0,NULL,NULL,'aggregate_daily_close')`);
  db.exec(BUILD_OBSERVED_USD_SQL);
  assert.deepEqual(
    { ...db.prepare(`SELECT usd,source,observed_day,fidelity FROM prices WHERE day='2026-01-01' AND currency='XCP'`).get() },
    { usd: 250, source: "coinmarketcap_aggregate", observed_day: "2026-01-01", fidelity: 2 },
  );
  db.exec(BUILD_XCP_USD_SQL);
  assert.equal(db.prepare(`SELECT usd FROM prices WHERE day='2026-01-01' AND currency='XCP'`).get()?.usd, 250);
  db.exec(`DELETE FROM market_price_observations WHERE source='coinmarketcap'`);
  db.exec(PRUNE_OBSERVED_USD_SQL);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM prices WHERE source='coinmarketcap_aggregate'`).get()?.n, 0);
  db.close();
});

test("observed aggregate BTC/USD fills only days without the higher-fidelity primary calendar", () => {
  const db = fixture();
  db.exec(`INSERT INTO market_price_observations VALUES
    ('2014-01-01','BTC','USD','coinmarketcap','aggregate',800,0,0,NULL,NULL,'aggregate_daily_close'),
    ('2026-01-01','BTC','USD','coinmarketcap','aggregate',90000,0,0,NULL,NULL,'aggregate_daily_close')`);
  db.exec(BUILD_OBSERVED_USD_SQL);
  assert.deepEqual(
    db.prepare(`SELECT day,usd,source,fidelity FROM prices WHERE currency='BTC' ORDER BY day`).all().map((row) => ({ ...row })),
    [
      { day: "2014-01-01", usd: 800, source: "coinmarketcap_aggregate", fidelity: 2 },
      { day: "2026-01-01", usd: 100000, source: "coinbase", fidelity: 3 },
      { day: "2026-01-08", usd: 110000, source: "coinbase", fidelity: 3 },
      { day: "2026-01-09", usd: 120000, source: "coinbase", fidelity: 3 },
    ],
  );
  db.exec(PRUNE_OBSERVED_USD_SQL);
  assert.equal(db.prepare(`SELECT usd FROM prices WHERE day='2014-01-01' AND currency='BTC'`).get()?.usd, 800);
  db.exec(`DELETE FROM market_price_observations WHERE base_currency='BTC' AND quote_currency='USD'`);
  db.exec(PRUNE_OBSERVED_USD_SQL);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM prices WHERE source='coinmarketcap_aggregate'`).get()?.n, 0);
  db.close();
});

test("derived XCP/USD replay is idempotent and stale pruning preserves observed prices", () => {
  const db = fixture();
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  const beforeReplay = Number(db.prepare(`SELECT total_changes() n`).get()?.n);
  db.exec(BUILD_XCP_USD_SQL);
  assert.equal(Number(db.prepare(`SELECT total_changes() n`).get()?.n) - beforeReplay, 0);

  db.exec(`
    INSERT INTO prices VALUES('2025-12-31','XCP',1,'dex_vwm','2025-12-31',1);
    INSERT INTO prices VALUES('2026-01-09','XCP',250,'market','2026-01-09',3);
  `);
  db.exec(PRUNE_XCP_USD_SQL);
  assert.deepEqual(
    db.prepare(`SELECT day,source FROM prices WHERE currency='XCP' ORDER BY day`).all().map((row) => ({ ...row })),
    [
      { day: "2026-01-01", source: "dex_vwm" },
      { day: "2026-01-08", source: "dex_vwm" },
      { day: "2026-01-09", source: "market" },
    ],
  );
  db.close();
});

test("trade USD reconciliation clears expired derivations without touching direct USD sales", () => {
  const db = fixture();
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
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
