import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  APPLY_SPOT_TRADE_USD_SQL,
  APPLY_TRADE_USD_SQL,
  BUILD_BURN_PRICE_OBSERVATIONS_SQL,
  BUILD_BURN_XCP_USD_SQL,
  BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL,
  BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_DAY_SQL,
  BUILD_DISPENSE_PRICE_OBSERVATIONS_SQL,
  BUILD_DISPENSE_PRICE_OBSERVATIONS_DAY_SQL,
  BUILD_MARKET_PRICE_OBSERVATIONS_SQL,
  BUILD_MARKET_PRICE_OBSERVATIONS_DAY_SQL,
  BUILD_OBSERVED_USD_SQL,
  BUILD_THIN_XCP_USD_DAY_SQL,
  BUILD_THIN_XCP_USD_SQL,
  BUILD_XCP_USD_DAY_SQL,
  BUILD_XCP_USD_SQL,
  BUILD_ZAIF_XCP_USD_SQL,
  PRUNE_COUNTERPARTY_PRICE_OBSERVATIONS_SQL,
  PRUNE_BURN_PRICE_OBSERVATIONS_SQL,
  PRUNE_BURN_XCP_USD_SQL,
  PRUNE_DISPENSE_PRICE_OBSERVATIONS_SQL,
  PRUNE_OBSERVED_USD_SQL,
  PRUNE_XCP_USD_SQL,
  PRUNE_ZAIF_XCP_USD_SQL,
  PRICE_SELECTION_POLICY,
  PRICE_SELECTION_PREDICATE,
  REFRESH_PRICING_HEALTH_SQL,
  tradeUsdWindow,
} from "#api/indexer/prices";
import { XCP_DAILY_CANDLES_SQL } from "#api/queries/prices";

test("the selected-price policy is named and resolves equal-fidelity sources deterministically", () => {
  assert.equal(PRICE_SELECTION_POLICY, "usd-payment-v1");
  const run = (sources: Array<[string, number]>) => {
    const db = fixture();
    for (const [source, usd] of sources)
      db.exec(`INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
        VALUES('2026-02-01','XCP',${usd},'${source}','2026-02-01',2)
        ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
          observed_day=excluded.observed_day,fidelity=excluded.fidelity WHERE ${PRICE_SELECTION_PREDICATE}`);
    const selected = { ...db.prepare(`SELECT usd,source FROM prices WHERE day='2026-02-01'`).get() };
    db.close();
    return selected;
  };
  const forward = run([
    ["dextrade_xcpbtc_spot", 2],
    ["coinmarketcap_aggregate", 3],
  ]);
  const reverse = run([
    ["coinmarketcap_aggregate", 3],
    ["dextrade_xcpbtc_spot", 2],
  ]);
  assert.deepEqual(forward, { usd: 3, source: "coinmarketcap_aggregate" });
  assert.deepEqual(reverse, forward);
});

test("a liquidity-qualified on-chain edge outranks reported and single-print quotes", () => {
  const run = (sources: Array<[string, number]>) => {
    const db = fixture();
    for (const [source, usd] of sources)
      db.exec(`INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
        VALUES('2026-02-01','XCP',${usd},'${source}','2026-02-01',2)
        ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
          observed_day=excluded.observed_day,fidelity=excluded.fidelity WHERE ${PRICE_SELECTION_PREDICATE}`);
    const selected = { ...db.prepare(`SELECT usd,source FROM prices WHERE day='2026-02-01'`).get() };
    db.close();
    return selected;
  };
  // The real 2026-08-25 disagreement: one Dex-Trade execution and CMC's aggregate both said 1.83
  // while the chain's own 25 dispenser fills said 2.85. The chain wins now, in either arrival order.
  const chainLast = run([
    ["dextrade_xcpbtc_spot", 1.83],
    ["coinmarketcap_aggregate", 1.83],
    ["market_vwm", 2.85],
  ]);
  const chainFirst = run([
    ["market_vwm", 2.85],
    ["coinmarketcap_aggregate", 1.83],
    ["dextrade_xcpbtc_spot", 1.83],
  ]);
  assert.deepEqual(chainLast, { usd: 2.85, source: "market_vwm" });
  assert.deepEqual(chainFirst, chainLast);
  // ...but a THIN on-chain day still loses to a real quote, which is what makes it safe.
  assert.deepEqual(
    run([
      ["market_vwm_thin", 2.85],
      ["coinmarketcap_aggregate", 1.83],
    ]),
    {
      usd: 1.83,
      source: "coinmarketcap_aggregate",
    },
  );
});

test("USD reconciliation advances new rows without wrapping when caught up", () => {
  assert.deepEqual(tradeUsdWindow(10, 20), { from: 10, to: 20 });
  assert.deepEqual(tradeUsdWindow(10, 300_020), { from: 10, to: 200_010 });
  assert.equal(tradeUsdWindow(20, 20), null);
  assert.equal(tradeUsdWindow(21, 20), null);
});

test("same-day spot reconciliation uses the block-time index and stays inside its epoch window", () => {
  const db = fixture();
  db.exec(`
    CREATE TABLE trades(block_time INTEGER,currency TEXT,total REAL,usd_value REAL);
    CREATE INDEX idx_trades_time ON trades(block_time DESC);
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2026-01-08','XCP',2,'dextrade_xcpbtc_spot','2026-01-08',2);
    INSERT INTO trades VALUES
      (strftime('%s','2026-01-08 12:00:00'),'BTC',2,NULL),
      (strftime('%s','2026-01-08 13:00:00'),'XCP',3,NULL),
      (strftime('%s','2026-01-07 23:59:59'),'BTC',4,NULL);
  `);
  const start = Number(db.prepare(`SELECT unixepoch('2026-01-08') value`).get()?.value);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${APPLY_SPOT_TRADE_USD_SQL}`).all(start, start + 86400);
  assert.ok(
    plan.some((row) => String(row.detail).includes("idx_trades_time") && String(row.detail).includes("block_time")),
    JSON.stringify(plan),
  );
  db.prepare(APPLY_SPOT_TRADE_USD_SQL).run(start, start + 86400);
  assert.deepEqual(
    db
      .prepare(`SELECT usd_value FROM trades ORDER BY block_time`)
      .all()
      .map((row) => row.usd_value),
    [null, 220000, 6],
  );
  db.close();
});

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE order_matches(
      forward_asset_id INTEGER,forward_quantity TEXT,backward_asset_id INTEGER,backward_quantity TEXT,
      block_time INTEGER,status TEXT,
      block_index INTEGER GENERATED ALWAYS AS (CAST(block_time/600 AS INTEGER)) VIRTUAL);
    CREATE INDEX idx_order_matches_block ON order_matches(block_index);
    CREATE TABLE dispensers(tx_index INTEGER PRIMARY KEY,give_quantity TEXT,satoshirate TEXT);
    CREATE TABLE dispenses(
      asset_id INTEGER,dispense_quantity TEXT,btc_amount TEXT,block_time INTEGER,
      source_id INTEGER,destination_id INTEGER,
      dispenser_tx_index INTEGER GENERATED ALWAYS AS (1) VIRTUAL,
      block_index INTEGER GENERATED ALWAYS AS (CAST(block_time/600 AS INTEGER)) VIRTUAL);
    CREATE INDEX idx_dispenses_asset ON dispenses(asset_id,block_index DESC);
    CREATE TABLE burns(block_time INTEGER,burned TEXT,earned TEXT,status TEXT);
    CREATE TABLE market_price_observations(
      day TEXT,base_currency TEXT,quote_currency TEXT,source TEXT,venue TEXT,price REAL,
      volume_base REAL,trades INTEGER,first_time INTEGER,last_time INTEGER,method TEXT,
      partitions INTEGER,
      PRIMARY KEY(day,base_currency,quote_currency,source,venue));
    CREATE TABLE prices(
      day TEXT,currency TEXT,usd REAL,source TEXT,observed_day TEXT,fidelity INTEGER NOT NULL DEFAULT 0,
      policy_version TEXT NOT NULL DEFAULT 'legacy-fidelity',price_kind TEXT NOT NULL DEFAULT 'unknown',
      age_days INTEGER,derivation_depth INTEGER,observation_count INTEGER,venue_count INTEGER,volume_base REAL,
      disagreement_class TEXT,selection_reason TEXT,
      PRIMARY KEY(day,currency));
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'BTC');
    INSERT INTO order_matches VALUES
      (1,'10000000000',2,'10000000',strftime('%s','2026-01-01'),'completed'),
      (1,'10000000000',2,'20000000',strftime('%s','2026-01-01'),'completed'),
      (1,'100000000',2,'100000000',strftime('%s','2026-01-01'),'completed'),
      (1,'100000000',2,'100000000',strftime('%s','2026-01-02'),'pending');
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity) VALUES
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
    {
      day: "2014-01-02",
      source: "counterparty",
      venue: "burn",
      price: 0.001,
      volume_base: 2000,
      trades: 2,
      method: "protocol_conversion_vwm",
    },
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
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2014-01-02','BTC',800,'coinmarketcap_aggregate','2014-01-02',2);
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2014-01-02','XCP',9,'coinmarketcap_archive','2014-01-02',0);
    INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method) VALUES(
      '2014-01-02','XCP','BTC','counterparty','burn',0.001,1000,2,NULL,NULL,'protocol_conversion_vwm');
  `);
  db.exec(BUILD_BURN_XCP_USD_SQL);
  assert.deepEqual(
    {
      ...db
        .prepare(`SELECT usd,source,observed_day,fidelity FROM prices WHERE day='2014-01-02' AND currency='XCP'`)
        .get(),
    },
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

test("current-day XCP observations stay inside the indexed block window", () => {
  const db = fixture();
  const fromBlock = 0;
  const toBlock = 10_000_000;
  db.prepare(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_DAY_SQL).run("2026-01-01", fromBlock, toBlock);
  assert.deepEqual(
    db
      .prepare(`SELECT day,venue,price FROM market_price_observations ORDER BY day,venue`)
      .all()
      .map((row) => ({ ...row })),
    [{ day: "2026-01-01", venue: "dex", price: 0.002 }],
  );

  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${BUILD_MARKET_PRICE_OBSERVATIONS_DAY_SQL}`)
    .all("2026-01-01", fromBlock, toBlock)
    .map((row) => String(row.detail));
  assert.ok(
    plan.some((detail) => detail.includes("idx_order_matches_block")),
    JSON.stringify(plan),
  );
  assert.ok(
    plan.some((detail) => detail.includes("idx_dispenses_asset")),
    JSON.stringify(plan),
  );
  db.close();
});

test("dispense observations use the protocol unit price when a payment overfills the final lot", () => {
  const db = fixture();
  db.exec(`
    DELETE FROM order_matches;
    INSERT INTO dispensers VALUES(1,'100000000','5000');
    INSERT INTO dispenses VALUES(
      1,'3100000000','495000',strftime('%s','2026-01-08 12:00:00'),10,20
    );
  `);
  const fromBlock = 0;
  const toBlock = 10_000_000;
  db.prepare(BUILD_DISPENSE_PRICE_OBSERVATIONS_DAY_SQL).run("2026-01-08", fromBlock, toBlock);
  db.prepare(BUILD_MARKET_PRICE_OBSERVATIONS_DAY_SQL).run("2026-01-08", fromBlock, toBlock);
  assert.deepEqual(
    db
      .prepare(`SELECT venue,price,volume_base,trades FROM market_price_observations ORDER BY venue`)
      .all()
      .map((row) => ({ ...row })),
    [
      { venue: "dispense", price: 0.00005, volume_base: 31, trades: 1 },
      { venue: "market", price: 0.00005, volume_base: 31, trades: 1 },
    ],
  );
  db.close();
});

test("XCP/BTC materialization is idempotent and prunes only obsolete source days", () => {
  const db = fixture();
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  const beforeReplay = Number(db.prepare(`SELECT total_changes() n`).get()?.n);
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  assert.equal(Number(db.prepare(`SELECT total_changes() n`).get()?.n) - beforeReplay, 0);

  db.exec(`INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method) VALUES(
    '2025-12-31','XCP','BTC','counterparty','dex',9,1,1,NULL,NULL,'volume_weighted_median')`);
  db.exec(PRUNE_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  assert.deepEqual(
    db
      .prepare(`SELECT day FROM market_price_observations ORDER BY day`)
      .all()
      .map((row) => row.day),
    ["2026-01-01"],
  );

  db.exec(`UPDATE order_matches SET backward_quantity='30000000' WHERE rowid=2`);
  db.exec(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL);
  assert.equal(db.prepare(`SELECT price FROM market_price_observations WHERE day='2026-01-01'`).get()?.price, 0.003);
  db.close();
});

test("derived XCP/USD expires after seven days and records provenance", () => {
  const db = fixture();
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
  // The fixture's day has 3 fills / 201 XCP — under the liquidity floor, so it prices at the
  // clearly-labeled THIN tier rather than the full-rank market cross-rate.
  assert.deepEqual(
    db
      .prepare(`SELECT day,usd,source,observed_day,fidelity FROM prices WHERE currency='XCP' ORDER BY day`)
      .all()
      .map((row) => ({ ...row })),
    [
      { day: "2026-01-01", usd: 200, source: "market_vwm_thin", observed_day: "2026-01-01", fidelity: 1 },
      { day: "2026-01-08", usd: 220, source: "market_vwm_thin", observed_day: "2026-01-01", fidelity: 1 },
    ],
  );
  assert.deepEqual(
    {
      ...db
        .prepare(
          `SELECT policy_version,price_kind,age_days,derivation_depth,observation_count,venue_count,
            volume_base,disagreement_class,selection_reason FROM prices
           WHERE currency='XCP' AND day='2026-01-08'`,
        )
        .get(),
    },
    {
      policy_version: "usd-payment-v1",
      price_kind: "derived",
      age_days: 7,
      derivation_depth: 1,
      observation_count: 3,
      venue_count: 1,
      volume_base: 201,
      disagreement_class: "not_evaluated",
      selection_reason: "thin_market_cross_rate",
    },
  );
  db.close();
});

test("a liquidity-qualified market day earns full rank and outranks the thin tier", () => {
  const db = fixture();
  // Ten 20-XCP fills on 2026-01-08 at 0.004 BTC/XCP: 10 trades, 200 XCP — clears the floor.
  // One per hour: this fixture used to stamp all ten at the SAME instant, which cleared the fill
  // and volume floor while being a single burst in a single bucket — precisely what
  // MARKET_EDGE_MIN_PARTITIONS now rejects. A day that means to be ordinary has to look ordinary.
  for (let i = 0; i < 10; i++) {
    db.prepare(
      `INSERT INTO order_matches VALUES(1,'2000000000',2,'8000000',
        strftime('%s','2026-01-08')+${i * 3600},'completed')`,
    ).run();
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
  assert.deepEqual(
    db
      .prepare(`SELECT day,usd,source FROM prices WHERE currency='XCP' ORDER BY day`)
      .all()
      .map((row) => ({ ...row })),
    [
      // 01-01: only the thin 3-fill edge reaches it — thin tier.
      { day: "2026-01-01", usd: 200, source: "market_vwm_thin" },
      // 01-08 and the 01-09 carry ride the QUALIFIED edge at full rank: 0.004 × BTC.
      { day: "2026-01-08", usd: 440, source: "market_vwm" },
      { day: "2026-01-09", usd: 480, source: "market_vwm" },
    ],
  );
  db.close();
});

test("hourly partitions stop one burst of trading owning the day's price", () => {
  const db = fixture();
  // 2026-01-08, five ordinary 20-XCP fills at 0.004 BTC/XCP spread across five hours...
  for (const hour of [2, 5, 9, 14, 20]) {
    db.exec(`INSERT INTO order_matches VALUES(1,'2000000000',2,'8000000',
      strftime('%s','2026-01-08')+${hour * 3600},'completed')`);
  }
  // ...and then ONE hour in which somebody pushes eight fills of 25x the size at half the price.
  // Unpartitioned this owns the day by sheer volume; partitioned it owns one bucket of six.
  for (let i = 0; i < 8; i += 1) {
    db.exec(`INSERT INTO order_matches VALUES(1,'50000000000',2,'100000000',
      strftime('%s','2026-01-08')+${11 * 3600 + i * 300},'completed')`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  const edge = {
    ...db
      .prepare(
        `SELECT price,trades,method FROM market_price_observations
        WHERE venue='market' AND day='2026-01-08'`,
      )
      .get(),
  };
  assert.equal(edge.method, "hourly_partitioned_volume_weighted_median");
  assert.equal(edge.trades, 13);
  // Five honest buckets at 0.004 against one manipulated bucket at 0.002: taking the MEDIAN of the
  // bucket medians outvotes the manipulated hour outright, where an unpartitioned volume-weighted
  // median would have handed the day its 0.002.
  assert.equal(Number(edge.price), 0.004);
  db.close();
});

test("a day whose fills are one burst does not price at full rank", () => {
  const db = fixture();
  // 2020-06-28 as it happened: fifteen fills, 1331 XCP — clears MIN_TRADES and MIN_VOLUME_XCP
  // comfortably — and every one of them inside a SINGLE hour. Counting fills and volume cannot see
  // that; one actor filling fifteen times in a minute looks identical to a day of trading.
  for (let i = 0; i < 15; i += 1) {
    db.exec(`INSERT INTO dispenses VALUES(1,'10000000000','1000000',
      strftime('%s','2020-06-28')+${9 * 3600 + i * 60},10,11)`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  const edge = {
    ...db
      .prepare(
        `SELECT trades,partitions FROM market_price_observations
        WHERE venue='market' AND day='2020-06-28'`,
      )
      .get(),
  };
  // The floor's own inputs say this day is fine...
  assert.equal(edge.trades, 15);
  // ...and the bucket count is what shows it is one burst, so the median behind the day's price
  // had exactly one vote and nothing to outvote a bad one with.
  assert.equal(edge.partitions, 1);
  assert.ok(Number(edge.partitions) < 5, "a one-bucket day must not clear MARKET_EDGE_MIN_PARTITIONS");
  db.close();
});

test("a day spread across the clock keeps its full-rank bucket count", () => {
  const db = fixture();
  // Same fifteen fills, same volume, spread over twelve hours instead of one.
  for (let i = 0; i < 15; i += 1) {
    db.exec(`INSERT INTO dispenses VALUES(1,'10000000000','1000000',
      strftime('%s','2020-06-29')+${(i % 12) * 3600 + i * 60},10,11)`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  const partitions = db
    .prepare(`SELECT partitions FROM market_price_observations WHERE venue='market' AND day='2020-06-29'`)
    .get()?.partitions;
  assert.equal(partitions, 12);
  assert.ok(Number(partitions) >= 5, "an ordinary day must still clear MARKET_EDGE_MIN_PARTITIONS");
  db.close();
});

test("a single absurd fill cannot take the day when it is alone in its hour", () => {
  const db = fixture();
  // 2021-08-09 as it actually happened, and as it actually broke. Thirteen fills across eleven
  // hourly buckets, ten of them holding exactly one fill — so in those ten, "the median of the
  // bucket" is just that one fill with no robustness left in it.
  //
  // Hour 0 is a dispenser that paid 0.03 BTC for ONE satoshi of XCP. Real, on-chain, and
  // economically meaningless at a price of 3,000,000 BTC/XCP.
  db.exec(`INSERT INTO dispenses VALUES(1,'1','3000000',strftime('%s','2021-08-09'),10,11)`);
  for (const hour of [1, 3, 4, 6, 9, 10, 15, 17]) {
    db.exec(`INSERT INTO dispenses VALUES(1,'1500000000','267000',
      strftime('%s','2021-08-09')+${hour * 3600},10,11)`);
  }
  for (const hour of [7, 18]) {
    db.exec(`INSERT INTO dispenses VALUES(1,'1000000000','75500',
      strftime('%s','2021-08-09')+${hour * 3600},10,11)`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  const price = Number(
    db.prepare(`SELECT price FROM market_price_observations WHERE venue='market' AND day='2021-08-09'`).get()?.price,
  );
  // Averaging the eleven bucket medians gave 3000000/11 = 272727.27, which crossed to USD as
  // $12.6 BILLION and became the site's published all-time high. A median outvotes it 10-to-1.
  assert.ok(price < 0.001, `the one-satoshi fill still owns the day at ${price}`);
  // ...and the honest cluster is what's left, not some other artefact.
  assert.ok(price > 0.0001, `the honest cluster was discarded too, got ${price}`);
  db.close();
});

test("partitioning leaves an ordinary day where it was", () => {
  const db = fixture();
  // Same five fills, same price, no burst: the partitioned median and the whole-day median agree.
  for (const hour of [2, 5, 9, 14, 20]) {
    db.exec(`INSERT INTO order_matches VALUES(1,'2000000000',2,'8000000',
      strftime('%s','2026-01-08')+${hour * 3600},'completed')`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  assert.equal(
    db.prepare(`SELECT price FROM market_price_observations WHERE venue='market' AND day='2026-01-08'`).get()?.price,
    0.004,
  );
  db.close();
});

test("dispense executions carry the on-chain price when the order book is silent", () => {
  const db = fixture();
  // 2026-01-08 has NO order matches — only two arm's-length dispenses at 0.003 BTC/XCP and one
  // literal self-fill at a fantasy price that must not count.
  db.exec(`INSERT INTO dispenses VALUES
    (1,'100000000','300000',strftime('%s','2026-01-08'),10,20),
    (1,'100000000','300000',strftime('%s','2026-01-08'),11,21),
    (1,'100000000','99900000',strftime('%s','2026-01-08'),12,12)`);
  db.exec(BUILD_DISPENSE_PRICE_OBSERVATIONS_SQL);
  assert.deepEqual(
    { ...db.prepare(`SELECT venue,price,trades,method FROM market_price_observations WHERE venue='dispense'`).get() },
    { venue: "dispense", price: 0.003, trades: 2, method: "volume_weighted_median" },
  );
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
  // Two fills are under the floor, so the fresher dispense edge prices the day on the thin tier:
  // 0.003 × 110,000 = 330 — labeled as thin evidence rather than silently at full rank.
  assert.deepEqual(
    { ...db.prepare(`SELECT usd,source,observed_day FROM prices WHERE currency='XCP' AND day='2026-01-08'`).get() },
    { usd: 330, source: "market_vwm_thin", observed_day: "2026-01-08" },
  );
  db.exec(`DELETE FROM dispenses`);
  db.exec(PRUNE_DISPENSE_PRICE_OBSERVATIONS_SQL);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM market_price_observations WHERE venue='dispense'`).get()?.n, 0);
  db.close();
});

test("daily candles keep error prints out of the wicks and dust-only days off the tape", () => {
  const db = fixture();
  // The 2026-01-01 fixture fills: 100 XCP @ 0.001, 100 XCP @ 0.002, and 1 XCP @ 1.0 — a fill 500×
  // off market that must not become the high. 2026-01-08 has two arm's-length dispenses @ 0.003
  // plus a self-fill that must not count. 2026-01-09 splits its volume evenly between an honest
  // fill and a 50× error print — volume share alone can't save the wick there; the ±10×-of-median
  // sanity band must. 2026-01-10 is a dust-only day (0.005 XCP) that must not chart at all.
  db.exec(`INSERT INTO dispenses VALUES
    (1,'100000000','300000',strftime('%s','2026-01-08'),10,20),
    (1,'100000000','300000',strftime('%s','2026-01-08'),11,21),
    (1,'100000000','99900000',strftime('%s','2026-01-08'),12,12)`);
  db.exec(`INSERT INTO order_matches VALUES
    (1,'10000000000',2,'10000000',strftime('%s','2026-01-09'),'completed'),
    (1,'10000000000',2,'500000000',strftime('%s','2026-01-09'),'completed'),
    (1,'500000',2,'650000',strftime('%s','2026-01-10'),'completed')`);
  assert.deepEqual(
    db
      .prepare(XCP_DAILY_CANDLES_SQL)
      .all()
      .map((row) => ({ ...row })),
    [
      { day: "2026-01-01", low: 0.001, close: 0.002, high: 0.002, volume: 201, fills: 3, btc: 100000 },
      { day: "2026-01-08", low: 0.003, close: 0.003, high: 0.003, volume: 2, fills: 2, btc: 110000 },
      { day: "2026-01-09", low: 0.001, close: 0.001, high: 0.001, volume: 200, fills: 2, btc: 120000 },
    ],
  );
  db.close();
});

test("a higher-fidelity observed price wins over a derived price", () => {
  const db = fixture();
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(`INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
    VALUES('2026-01-01','XCP',250,'market','2026-01-01',3)`);
  db.exec(BUILD_XCP_USD_SQL);
  assert.deepEqual(
    { ...db.prepare(`SELECT usd,source,fidelity FROM prices WHERE day='2026-01-01' AND currency='XCP'`).get() },
    { usd: 250, source: "market", fidelity: 3 },
  );
  db.close();
});

test("observed aggregate XCP/USD outranks the derived cross-rate and reconciles by provenance", () => {
  const db = fixture();
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(`INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method) VALUES(
    '2026-01-01','XCP','USD','coinmarketcap','aggregate',250,0,0,NULL,NULL,'aggregate_daily_close')`);
  db.exec(BUILD_OBSERVED_USD_SQL);
  assert.deepEqual(
    {
      ...db
        .prepare(`SELECT usd,source,observed_day,fidelity FROM prices WHERE day='2026-01-01' AND currency='XCP'`)
        .get(),
    },
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
  db.exec(`INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method) VALUES
    ('2014-01-01','BTC','USD','coinmarketcap','aggregate',800,0,0,NULL,NULL,'aggregate_daily_close'),
    ('2026-01-01','BTC','USD','coinmarketcap','aggregate',90000,0,0,NULL,NULL,'aggregate_daily_close')`);
  db.exec(BUILD_OBSERVED_USD_SQL);
  assert.deepEqual(
    db
      .prepare(`SELECT day,usd,source,fidelity FROM prices WHERE currency='BTC' ORDER BY day`)
      .all()
      .map((row) => ({ ...row })),
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
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
  const beforeReplay = Number(db.prepare(`SELECT total_changes() n`).get()?.n);
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
  assert.equal(Number(db.prepare(`SELECT total_changes() n`).get()?.n) - beforeReplay, 0);

  // A stale market_vwm day, a LEGACY dex_vwm row (superseded source, always re-won or purged), and
  // a higher-fidelity observed row that pruning must never touch.
  db.exec(`
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2025-12-31','XCP',1,'market_vwm','2025-12-31',1);
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2025-12-30','XCP',1,'dex_vwm','2025-12-30',1);
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2026-01-09','XCP',250,'market','2026-01-09',3);
  `);
  db.exec(PRUNE_XCP_USD_SQL);
  assert.deepEqual(
    db
      .prepare(`SELECT day,source FROM prices WHERE currency='XCP' ORDER BY day`)
      .all()
      .map((row) => ({ ...row })),
    [
      { day: "2026-01-01", source: "market_vwm_thin" },
      { day: "2026-01-08", source: "market_vwm_thin" },
      { day: "2026-01-09", source: "market" },
    ],
  );
  db.close();
});

test("Zaif XCP/JPY crosses through ECB at rank between the CMC aggregate and the Dex-Trade spot", () => {
  const db = fixture();
  db.exec(`
    INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method) VALUES
      ('2026-01-08','XCP','JPY','zaif','cex',200,11,2,NULL,NULL,'volume_weighted_median'),
      ('2026-01-06','EUR','USD','ecb','reference',1.10,0,0,NULL,NULL,'reference_rate'),
      ('2026-01-06','EUR','JPY','ecb','reference',160,0,0,NULL,NULL,'reference_rate');
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2026-01-08','XCP',1.6,'dextrade_xcpbtc_spot','2026-01-08',2);
  `);
  db.exec(BUILD_ZAIF_XCP_USD_SQL);
  // ¥200 × (1.10/160) = $1.375 replaces the lower-ranked spot; FX carried 2 days (≤4 allowed).
  assert.deepEqual(
    {
      ...db
        .prepare(
          `SELECT ROUND(usd,6) usd,source,fidelity,observation_count,volume_base,selection_reason
           FROM prices WHERE day='2026-01-08' AND currency='XCP'`,
        )
        .get(),
    },
    {
      usd: 1.375,
      source: "zaif_vwm",
      fidelity: 2,
      observation_count: 2,
      volume_base: 11,
      selection_reason: "first_party_cex_fx_cross",
    },
  );
  // The CMC aggregate still outranks it on any day it covers.
  db.exec(`INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method) VALUES(
    '2026-01-08','XCP','USD','coinmarketcap','aggregate',1.42,0,0,NULL,NULL,'aggregate_daily_close')`);
  db.exec(BUILD_OBSERVED_USD_SQL);
  assert.equal(
    db.prepare(`SELECT source FROM prices WHERE day='2026-01-08' AND currency='XCP'`).get()?.source,
    "coinmarketcap_aggregate",
  );
  // A Zaif day whose FX legs are older than the 4-day carry produces NO row.
  db.exec(`INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method) VALUES
    ('2026-01-20','XCP','JPY','zaif','cex',210,3,1,NULL,NULL,'volume_weighted_median')`);
  db.exec(BUILD_ZAIF_XCP_USD_SQL);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM prices WHERE day='2026-01-20' AND currency='XCP'`).get()?.n, 0);
  // Prune removes zaif_vwm rows whose observation evidence is gone.
  db.exec(`
    INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
      VALUES('2025-12-01','XCP',1,'zaif_vwm','2025-12-01',2);
  `);
  db.exec(PRUNE_ZAIF_XCP_USD_SQL);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM prices WHERE source='zaif_vwm' AND day='2025-12-01'`).get()?.n, 0);
  db.close();
});

test("trade USD reconciliation clears expired derivations without touching direct USD sales", () => {
  const db = fixture();
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
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

test("pricing health materializes coverage, divergence, and latest source without hiding missing rows", () => {
  const db = fixture();
  db.exec(`
    CREATE TABLE trades(block_time INTEGER,currency TEXT,total REAL,usd_value REAL);
    CREATE TABLE pricing_health(currency TEXT PRIMARY KEY,trades INTEGER,missing INTEGER,divergent INTEGER,
      latest_price_day TEXT,latest_price_source TEXT,latest_observed_day TEXT,generated_at INTEGER);
    INSERT INTO trades VALUES
      (strftime('%s','2026-01-01'),'BTC',2,200000),
      (strftime('%s','2026-01-09'),'XCP',2,NULL),
      (strftime('%s','2026-01-01'),'USDC',3,2);
  `);
  db.prepare(REFRESH_PRICING_HEALTH_SQL).run(123);
  assert.deepEqual(
    db
      .prepare(
        `SELECT currency,trades,missing,divergent,latest_price_day,latest_price_source,generated_at
      FROM pricing_health ORDER BY currency`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        currency: "BTC",
        trades: 1,
        missing: 0,
        divergent: 0,
        latest_price_day: "2026-01-09",
        latest_price_source: "coinbase",
        generated_at: 123,
      },
      {
        currency: "ETH",
        trades: 0,
        missing: 0,
        divergent: 0,
        latest_price_day: null,
        latest_price_source: null,
        generated_at: 123,
      },
      {
        currency: "USDC",
        trades: 1,
        missing: 0,
        divergent: 1,
        latest_price_day: null,
        latest_price_source: null,
        generated_at: 123,
      },
      {
        currency: "XCP",
        trades: 1,
        missing: 1,
        divergent: 0,
        latest_price_day: null,
        latest_price_source: null,
        generated_at: 123,
      },
    ],
  );
  db.close();
});

test("the liquidity floor admits a small day that is well spread", () => {
  const db = fixture();
  // 2026-01-08 in miniature: twelve fills, one an hour, 53 XCP all told. The
  // old MIN_VOLUME_XCP of 100 rejected this — a day a dozen people traded
  // across half the clock, thrown out for being small. Small is not manipulated.
  for (let hour = 0; hour < 12; hour += 1) {
    db.exec(`INSERT INTO dispenses VALUES(1,'440000000','78320',
      strftime('%s','2026-01-08')+${hour * 3600},10,11)`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  const row = {
    ...db.prepare(`SELECT source FROM prices WHERE day='2026-01-08' AND currency='XCP'`).get(),
  };
  assert.equal(row.source, "market_vwm", "a well-spread 12-fill day must price at full rank");
  db.close();
});

test("dust still cannot anchor a day, however well spread", () => {
  const db = fixture();
  // The case the remaining 1 XCP guard exists for: twelve fills across twelve
  // hours — clearing MIN_TRADES and MIN_PARTITIONS outright — for a few
  // satoshi in total. Spreading dust over the clock must not buy full rank.
  for (let hour = 0; hour < 12; hour += 1) {
    db.exec(`INSERT INTO dispenses VALUES(1,'100','1',
      strftime('%s','2026-01-09')+${hour * 3600},10,11)`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  const n = db
    .prepare(`SELECT COUNT(*) n FROM prices WHERE day='2026-01-09' AND currency='XCP' AND source='market_vwm'`)
    .get()?.n;
  assert.equal(n, 0, "a dust-only day must not reach full rank");
  db.close();
});

test("the every-block day refresh reclaims a day an exchange spot took at midnight", () => {
  const db = fixture();
  // A liquidity-qualified chain edge on the 8th: 3,600 sats, sixteen fills across five hours.
  db.exec(`INSERT INTO market_price_observations(day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method,partitions)
    VALUES('2026-01-08','XCP','BTC','counterparty','market',0.000036,298,16,NULL,NULL,'hourly_partitioned_volume_weighted_median',5)`);
  // Midnight on the 9th: crawlSpotPrices writes the Dex-Trade print, and for as long as nothing
  // re-derives the chain's side it stands unopposed — this is the state the published price was in
  // for hours every day.
  db.exec(`INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
    VALUES('2026-01-09','XCP',2.7,'dextrade_xcpbtc_spot','2026-01-09',2)`);
  assert.equal(
    db.prepare(`SELECT source FROM prices WHERE day='2026-01-09' AND currency='XCP'`).get()?.source,
    "dextrade_xcpbtc_spot",
  );

  db.prepare(BUILD_XCP_USD_DAY_SQL).run("2026-01-09");
  db.prepare(BUILD_THIN_XCP_USD_DAY_SQL).run("2026-01-09");

  // The chain's carried edge takes the day back: 0.000036 x 120,000 BTC/USD.
  assert.deepEqual(
    {
      ...db
        .prepare(`SELECT usd,source,observed_day,age_days FROM prices WHERE day='2026-01-09' AND currency='XCP'`)
        .get(),
    },
    { usd: 4.32, source: "market_vwm", observed_day: "2026-01-08", age_days: 1 },
  );
  // And it touched ONLY that day. The 8th is priceable from the same edge but was not in scope,
  // which is what keeps this affordable on a per-block schedule.
  assert.deepEqual(
    db
      .prepare(`SELECT day FROM prices WHERE currency='XCP' ORDER BY day`)
      .all()
      .map((r) => r.day),
    ["2026-01-09"],
  );
  // Replaying writes nothing, so the schedule cannot churn D1 on an unchanged day.
  const before = Number(db.prepare(`SELECT total_changes() n`).get()?.n);
  db.prepare(BUILD_XCP_USD_DAY_SQL).run("2026-01-09");
  db.prepare(BUILD_THIN_XCP_USD_DAY_SQL).run("2026-01-09");
  assert.equal(Number(db.prepare(`SELECT total_changes() n`).get()?.n) - before, 0);

  // The unbounded daily build is unchanged by the parameterisation and still prices the rest.
  db.exec(BUILD_XCP_USD_SQL);
  assert.deepEqual(
    db
      .prepare(`SELECT day FROM prices WHERE currency='XCP' ORDER BY day`)
      .all()
      .map((r) => r.day),
    ["2026-01-08", "2026-01-09"],
  );
  db.close();
});

test("the floor reads volume and time-spread, not a count of transactions", () => {
  // 2026-08-09 on mainnet: four dispenses, 396 XCP. The old floor rejected it on a count of 4 and
  // handed the day to a CoinMarketCap print ~40% below where the chain was clearing. Volume and
  // spread both say it is a real day, and they are what decides now.
  const db = fixture();
  for (const [i, hour] of [1, 6, 11, 17, 22].entries()) {
    db.exec(`INSERT INTO dispenses VALUES(1,'${(80 + i) * 1e8}','${(80 + i) * 4000}',
      strftime('%s','2026-01-08')+${hour * 3600},10,11)`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  const edge = {
    ...db
      .prepare(
        `SELECT trades,partitions,ROUND(volume_base) volume_base
                FROM market_price_observations WHERE venue='market' AND day='2026-01-08'`,
      )
      .get(),
  };
  // Five transactions -- under the count the old floor demanded -- but 410 XCP across five hours.
  assert.equal(edge.trades, 5);
  assert.equal(edge.partitions, 5);
  assert.equal(edge.volume_base, 410);

  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
  assert.equal(
    db.prepare(`SELECT source FROM prices WHERE day='2026-01-08' AND currency='XCP'`).get()?.source,
    "market_vwm",
  );

  // The same volume compressed into four hours stays out: time-spread is the leg that survived
  // every re-derivation, and it is the only one that can see a burst.
  const burst = fixture();
  for (const [i, hour] of [1, 2, 3, 4].entries()) {
    burst.exec(`INSERT INTO dispenses VALUES(1,'${(100 + i) * 1e8}','${(100 + i) * 4000}',
      strftime('%s','2026-01-08')+${hour * 3600},10,11)`);
  }
  burst.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  burst.exec(BUILD_XCP_USD_SQL);
  burst.exec(BUILD_THIN_XCP_USD_SQL);
  assert.equal(
    burst.prepare(`SELECT partitions FROM market_price_observations WHERE venue='market' AND day='2026-01-08'`).get()
      ?.partitions,
    4,
  );
  assert.equal(
    burst.prepare(`SELECT source FROM prices WHERE day='2026-01-08' AND currency='XCP'`).get()?.source,
    "market_vwm_thin",
  );
  burst.close();
  db.close();
});

test("a well-spread day carrying too little money stays on the thin tier", () => {
  // Five hours, five fills, 5 XCP. Spread is honest; the money at stake is not, and
  // MARKET_EDGE_MIN_VOLUME_XCP is the leg that says so.
  const db = fixture();
  for (const hour of [1, 6, 11, 17, 22]) {
    db.exec(`INSERT INTO dispenses VALUES(1,'${1e8}','4000',
      strftime('%s','2026-01-08')+${hour * 3600},10,11)`);
  }
  db.exec(BUILD_MARKET_PRICE_OBSERVATIONS_SQL);
  db.exec(BUILD_XCP_USD_SQL);
  db.exec(BUILD_THIN_XCP_USD_SQL);
  const edge = {
    ...db
      .prepare(
        `SELECT partitions,ROUND(volume_base) volume_base FROM market_price_observations
                WHERE venue='market' AND day='2026-01-08'`,
      )
      .get(),
  };
  assert.equal(edge.partitions, 5);
  assert.equal(edge.volume_base, 5);
  assert.equal(
    db.prepare(`SELECT source FROM prices WHERE day='2026-01-08' AND currency='XCP'`).get()?.source,
    "market_vwm_thin",
  );
  db.close();
});
