import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  FIRST_YEAR,
  YEAR_STATS_DETAIL_SQL,
  YEARS_CATALOG,
  toOhlc,
  yearActivityLedger,
  yearBurn,
  yearCurrencySale,
  yearCleanLedger,
  yearCollections,
  yearEnd,
  yearMonthly,
  yearNewcomerLedger,
  yearOhlcLedger,
  yearPepecashVwap,
  yearProtocol,
  yearRawDexLedger,
  yearSaleOfYear,
  yearSettlement,
  yearStatsDetail,
  yearStart,
  yearTopAssets,
} from "#api/queries/years";
import { YEARS_INDEX_CACHE_KEY, YEARS_INDEX_STALE_CACHE_KEY, readCachedYearIndex } from "#api/read/years";

class Statement {
  private bound: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.bound = values;
    return this;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.bound as never[])) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.bound as never[])) as T | undefined) ?? null;
  }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

const T2017 = yearStart(2017);

function fixture(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE transactions(tx_index INTEGER PRIMARY KEY, block_time INTEGER, source_id INTEGER);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY, asset_longname TEXT, issuer_id INTEGER,
      first_issuance_block_time INTEGER);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY, asset TEXT);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY, low_quality INTEGER);
    CREATE TABLE trades(venue TEXT, ref TEXT, asset_id INTEGER, block_time INTEGER,
      quantity REAL, currency TEXT, total REAL, usd_value REAL, buyer_id INTEGER, seller_id INTEGER,
      PRIMARY KEY(venue, ref));
    CREATE TABLE prices(day TEXT, currency TEXT, usd REAL, PRIMARY KEY(day, currency));
    CREATE TABLE burns(tx_index INTEGER PRIMARY KEY, block_time INTEGER, source_id INTEGER,
      burned TEXT, earned TEXT);
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY, entity_type TEXT, entity_key TEXT);
    CREATE TABLE collection_membership_evidence(entity_id INTEGER, tag TEXT, source TEXT);
    CREATE TABLE tags(entity_id INTEGER, tag TEXT, source TEXT, meta TEXT);
    CREATE TABLE blocks(block_index INTEGER PRIMARY KEY, block_time INTEGER);
    CREATE INDEX idx_blocks_time ON blocks(block_time,block_index);
    CREATE TABLE sends(block_index INTEGER);
    CREATE INDEX idx_sends_block ON sends(block_index);
    CREATE TABLE issuances(block_index INTEGER, locked INTEGER, transfer INTEGER);
    CREATE INDEX idx_issuances_block ON issuances(block_index);

    INSERT INTO asset_dictionary VALUES (1,'CARD'), (2,'WASHY'), (3,'PEPECASH');
    INSERT INTO assets VALUES (1, NULL, 10, ${T2017 + 1000}), (2, NULL, 11, ${T2017 + 2000}),
      (3, NULL, 12, ${yearStart(2016) + 5});
    INSERT INTO asset_signals VALUES (1, 0), (2, 1), (3, 0);

    -- 2017: two actors, one of whom first appeared in 2016 (so exactly one 2017 newcomer).
    INSERT INTO transactions VALUES (1, ${yearStart(2016) + 10}, 100), (2, ${T2017 + 10}, 100),
      (3, ${T2017 + 20}, 200), (4, ${T2017 + 30}, 200);

    -- Clean CARD fill ($500, qty 1, in XCP), wash WASHY fill ($900), PEPECASH liquidity both ends.
    INSERT INTO trades VALUES
      ('dex','a',1,${T2017 + 100},1,'XCP',5,500,100,200),
      ('dex','b',2,${T2017 + 200},10,'XCP',50,900,100,200),
      ('dex','p1',3,${T2017 + 300},1000,'XCP',1,30,100,200),
      ('dex','p2',3,${yearEnd(2017) - 100},1000,'XCP',1,60,100,200);
    -- Pad PEPECASH endpoint months to the >=10 fills VWAP guard.
    ${Array.from({ length: 9 }, (_, i) => `INSERT INTO trades VALUES ('dex','pj${i}',3,${T2017 + 400 + i},1000,'XCP',1,30,100,200);`).join("\n")}
    ${Array.from({ length: 9 }, (_, i) => `INSERT INTO trades VALUES ('dex','pd${i}',3,${yearEnd(2017) - 300 - i},1000,'XCP',1,60,100,200);`).join("\n")}

    INSERT INTO prices VALUES ('2017-01-01','XCP',1.92), ('2017-06-01','XCP',10),
      ('2017-12-31','XCP',32.86), ('2017-01-01','BTC',992.95), ('2017-12-31','BTC',13863.13);

    INSERT INTO burns VALUES
      (1, ${yearStart(2014) + 100}, 500, '100000000', '150000000000'),
      (2, ${yearStart(2014) + 200}, 501, '50000000', '75000000000');

    INSERT INTO entity_dictionary VALUES (7,'asset','CARD');
    INSERT INTO collection_membership_evidence VALUES (7,'rare-pepe','tokenscan');
    INSERT INTO tags VALUES (7,'rare-pepe','tokenscan','{"collection":"Rare Pepe"}');
  `);
  return d1(db);
}

test("year ledgers bucket activity, newcomers and market by year", async () => {
  const db = fixture();
  const activity = await yearActivityLedger(db);
  assert.deepEqual({ ...activity.find((row) => row.y === "2017") }, { y: "2017", transactions: 3, actors: 2 });
  const newcomers = await yearNewcomerLedger(db);
  assert.equal(newcomers.find((row) => row.y === "2017")?.newcomers, 1);
  assert.equal(newcomers.find((row) => row.y === "2016")?.newcomers, 1);
  const raw = await yearRawDexLedger(db);
  assert.equal(raw.find((row) => row.y === "2017")?.fills, 22);
  const clean = await yearCleanLedger(db);
  // The $900 WASHY fill is excluded by low_quality; everything else counts.
  assert.equal(clean.find((row) => row.y === "2017")?.usd, 500 + 30 + 60 + 9 * 30 + 9 * 60);
});

test("year pages reuse the current materialized index and fall back to the prior version", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE cache(key TEXT PRIMARY KEY, body TEXT)`);
  raw
    .prepare(`INSERT INTO cache VALUES(?,?)`)
    .run(YEARS_INDEX_STALE_CACHE_KEY, JSON.stringify({ result: { as_of: 10, years: [] } }));
  raw
    .prepare(`INSERT INTO cache VALUES(?,?)`)
    .run(YEARS_INDEX_CACHE_KEY, JSON.stringify({ result: { as_of: 11, years: [] } }));

  assert.equal((await readCachedYearIndex(d1(raw)))?.as_of, 11);
  raw.prepare(`DELETE FROM cache WHERE key=?`).run(YEARS_INDEX_CACHE_KEY);
  assert.equal((await readCachedYearIndex(d1(raw)))?.as_of, 10);
  raw.prepare(`UPDATE cache SET body='not-json'`).run();
  assert.equal(await readCachedYearIndex(d1(raw)), null);
  raw.close();
});

test("clean year detail excludes flagged assets and prices PEPECASH endpoints", async () => {
  const db = fixture();
  const start = yearStart(2017);
  const end = yearEnd(2017);
  const top = await yearTopAssets(db, start, end);
  assert.ok(!top.some((row) => row.asset === "WASHY"));
  assert.equal(top[0]?.asset, "PEPECASH");
  const sale = await yearSaleOfYear(db, start, end);
  assert.equal(sale?.asset, "CARD");
  assert.equal(sale?.usd, 500);
  const settlement = await yearSettlement(db, start, end);
  assert.equal(settlement[0]?.currency, "XCP");
  const monthly = await yearMonthly(db, start, end);
  assert.equal(monthly.length, 12);
  assert.equal(monthly[0]?.month, 1);
  assert.ok(monthly[0]!.clean_usd > 0);
  const vwap = await yearPepecashVwap(db, start, end);
  assert.ok(vwap);
  assert.equal(vwap!.first_vwap, 0.03);
  assert.equal(vwap!.last_vwap, 0.06);
  assert.equal(vwap!.change_pct, 100);
});

test("year protocol counts seek events through the exact block-time window", async () => {
  const start = yearStart(2017);
  const end = yearEnd(2017);
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE blocks(block_index INTEGER PRIMARY KEY,block_time INTEGER);
    CREATE INDEX idx_blocks_time ON blocks(block_time,block_index);
    CREATE TABLE sends(block_index INTEGER);
    CREATE INDEX idx_sends_block ON sends(block_index);
    CREATE TABLE issuances(block_index INTEGER,locked INTEGER,transfer INTEGER);
    CREATE INDEX idx_issuances_block ON issuances(block_index);
  `);
  raw.prepare(`INSERT INTO blocks VALUES(1,?),(2,?),(3,?)`).run(start, end - 1, end + 1);
  raw.exec(`INSERT INTO sends VALUES(1),(2),(3);
    INSERT INTO issuances VALUES(1,1,0),(2,0,1),(3,1,1);`);
  const db = d1(raw);

  assert.deepEqual(
    { ...(await yearStatsDetail(db, start, end)) },
    {
      sends: 2,
      supply_locks: 1,
      ownership_transfers: 1,
    },
  );
  const plan = raw
    .prepare(`EXPLAIN QUERY PLAN ${YEAR_STATS_DETAIL_SQL}`)
    .all(start, end)
    .map((row) => String(row.detail));
  assert.ok(plan.some((detail) => detail.includes("idx_blocks_time")));
  assert.ok(plan.some((detail) => detail.includes("idx_sends_block")));
  assert.ok(plan.filter((detail) => detail.includes("idx_issuances_block")).length >= 2);
  assert.equal(
    plan.some((detail) => detail.startsWith("SCAN sends") || detail.startsWith("SCAN issuances")),
    false,
  );
  raw.close();
});

test("burn totals appear only inside the burn window and currency sale skips collection members", async () => {
  const db = fixture();
  const burn = await yearBurn(db, yearStart(2014), yearEnd(2014));
  assert.deepEqual(
    { ...burn },
    {
      burns: 2,
      burners: 2,
      btc_burned: 1.5,
      xcp_earned: 2250,
      first_day: "2014-01-01",
      last_day: "2014-01-01",
    },
  );
  assert.equal(await yearBurn(db, yearStart(2017), yearEnd(2017)), null);
  // CARD is a collection member and WASHY is wash-flagged; the coins side falls to PEPECASH.
  const sale = await yearCurrencySale(db, yearStart(2017), yearEnd(2017));
  assert.equal(sale?.asset, "PEPECASH");
  assert.equal(sale?.usd, 60);
});

test("collections resolve display names from tag metadata", async () => {
  const db = fixture();
  const collections = await yearCollections(db, yearStart(2017), yearEnd(2017));
  assert.deepEqual({ ...collections[0] }, { tag: "rare-pepe", name: "Rare Pepe", cards: 1 });
});

test("ohlc ledger computes open/close and change", async () => {
  const db = fixture();
  const xcp = await yearOhlcLedger(db, "XCP");
  const summary = toOhlc(xcp.find((row) => row.y === "2017"));
  assert.ok(summary);
  assert.equal(summary!.open, 1.92);
  assert.equal(summary!.close, 32.86);
  assert.equal(summary!.high, 32.86);
  assert.equal(summary!.change_pct, 1611.5);
});

test("catalog covers every year and protocol dates stay inside their year", () => {
  const now = new Date().getUTCFullYear();
  for (let year = FIRST_YEAR; year <= Math.min(now, 2026); year++) {
    const editorial = YEARS_CATALOG[year];
    assert.ok(editorial, `catalog missing ${year}`);
    assert.ok(editorial!.title.length > 0);
    assert.ok(editorial!.moments.length >= 4, `${year} needs at least 4 moments`);
    for (const event of yearProtocol(year)) {
      assert.ok(event.date.startsWith(String(year)), `${event.name} dated outside ${year}`);
    }
  }
});
