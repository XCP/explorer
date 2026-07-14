import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { reconcileCoreProjection } from "#api/indexer/core-projections";

class PreparedStatement {
  private binds: unknown[] = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.binds = values;
    return this;
  }
  async run() {
    this.database.prepare(this.sql).run(...this.binds);
    return { success: true };
  }
  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.binds) as T[] };
  }
  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.binds) as T | undefined) ?? null;
  }
}

function d1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new PreparedStatement(database, sql);
    },
    async batch(statements: PreparedStatement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

function databases() {
  const source = new DatabaseSync(":memory:");
  source.exec(`
    CREATE TABLE prices(day TEXT,currency TEXT,usd REAL,source TEXT,PRIMARY KEY(day,currency));
    CREATE TABLE xcp_btc_daily(day TEXT PRIMARY KEY,xcpbtc REAL);
    CREATE TABLE scarce_city_sales(asset TEXT,sold_at INTEGER,price_btc REAL,PRIMARY KEY(asset,sold_at));
    CREATE TABLE emblem_sales(
      tx_hash TEXT,log_index INTEGER,contract TEXT,token_id TEXT,price_raw TEXT,token_addr TEXT,
      marketplace TEXT,buyer TEXT,seller TEXT,block_number INTEGER,PRIMARY KEY(tx_hash,log_index)
    );
  `);
  const compact = new DatabaseSync(":memory:");
  compact.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO core_state VALUES('build_complete','1'),('import_complete','1');
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT NOT NULL UNIQUE);
    CREATE TABLE prices(day TEXT,currency TEXT,usd REAL,source TEXT,PRIMARY KEY(day,currency));
    CREATE TABLE xcp_btc_daily(day TEXT PRIMARY KEY,xcpbtc REAL);
    CREATE TABLE scarce_city_sales(asset_id INTEGER,sold_at INTEGER,price_btc REAL,PRIMARY KEY(asset_id,sold_at));
    CREATE TABLE emblem_sales(
      tx_hash TEXT,log_index INTEGER,contract_id INTEGER,token_id TEXT,price_raw TEXT,token_address_id INTEGER,
      marketplace TEXT,buyer_id INTEGER,seller_id INTEGER,block_number INTEGER,PRIMARY KEY(tx_hash,log_index)
    );
  `);
  return { source, compact, env: { DB: d1(source), CORE_DB: d1(compact) } };
}

test("incremental projection reconciliation upserts bounded pages and dictionary identities", async () => {
  const { source, compact, env } = databases();
  source.exec(`
    INSERT INTO prices VALUES('2026-07-12','BTC',100000,'coinbase');
    INSERT INTO prices VALUES('2026-07-13','BTC',101000,'coinbase');
    INSERT INTO scarce_city_sales VALUES('RAREPEPE',123,0.25);
    INSERT INTO emblem_sales VALUES('abc',1,'contract','7','10','token','market','buyer','seller',99);
  `);
  compact.exec(`INSERT INTO prices VALUES('2026-07-12','BTC',1,'stale')`);

  const first = await reconcileCoreProjection(env, "prices", 1);
  const second = await reconcileCoreProjection(env, "prices", 1);
  assert.deepEqual(first, { table: "prices", processed: 1, cursor: 1, high_water: 2, caught_up: false });
  assert.equal(second.caught_up, true);
  assert.deepEqual(
    compact
      .prepare(`SELECT day,usd,source FROM prices ORDER BY day`)
      .all()
      .map((row) => ({ ...row })),
    [
      { day: "2026-07-12", usd: 100000, source: "coinbase" },
      { day: "2026-07-13", usd: 101000, source: "coinbase" },
    ],
  );

  assert.equal((await reconcileCoreProjection(env, "scarce_city_sales")).caught_up, true);
  assert.deepEqual(
    {
      ...compact
        .prepare(
          `SELECT a.asset,s.sold_at,s.price_btc FROM scarce_city_sales s JOIN asset_dictionary a USING(asset_id)`,
        )
        .get(),
    },
    {
      asset: "RAREPEPE",
      sold_at: 123,
      price_btc: 0.25,
    },
  );

  assert.equal((await reconcileCoreProjection(env, "emblem_sales")).caught_up, true);
  assert.deepEqual(
    {
      ...compact
        .prepare(
          `SELECT c.address contract,t.address token,b.address buyer,v.address seller
           FROM emblem_sales e
           JOIN address_dictionary c ON c.address_id=e.contract_id
           JOIN address_dictionary t ON t.address_id=e.token_address_id
           JOIN address_dictionary b ON b.address_id=e.buyer_id
           JOIN address_dictionary v ON v.address_id=e.seller_id`,
        )
        .get(),
    },
    { contract: "contract", token: "token", buyer: "buyer", seller: "seller" },
  );
});

test("projection reconciliation remains closed before the compact import completes", async () => {
  const { compact, env } = databases();
  compact.exec(`UPDATE core_state SET value='0' WHERE key='import_complete'`);
  assert.deepEqual(await reconcileCoreProjection(env, "prices"), {
    table: "prices",
    skipped: "compact import is incomplete",
  });
  let error: unknown;
  try {
    await reconcileCoreProjection(env, "tags");
  } catch (caught) {
    error = caught;
  }
  assert.match(String(error), /unsupported incremental projection/);
});
