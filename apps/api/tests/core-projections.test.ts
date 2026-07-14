import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { reconcileCoreProjection, upsertCoreEmblemVaultIdentities } from "#api/indexer/core-projections";

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
    CREATE TABLE emblem_listings(
      token_id TEXT,contract TEXT,asset TEXT,order_id TEXT,marketplace TEXT,price_usd REAL,
      price_amount TEXT,currency TEXT,url TEXT,expiry INTEGER,updated_at INTEGER,
      PRIMARY KEY(contract,token_id)
    );
    CREATE TABLE prices(day TEXT,currency TEXT,usd REAL,source TEXT,PRIMARY KEY(day,currency));
    CREATE TABLE xcp_btc_daily(day TEXT PRIMARY KEY,xcpbtc REAL);
    CREATE TABLE scarce_city_sales(asset TEXT,sold_at INTEGER,price_btc REAL,PRIMARY KEY(asset,sold_at));
    CREATE TABLE emblem_sales(
      tx_hash TEXT,log_index INTEGER,contract TEXT,token_id TEXT,price_raw TEXT,token_addr TEXT,
      marketplace TEXT,buyer TEXT,seller TEXT,block_number INTEGER,PRIMARY KEY(tx_hash,log_index)
    );
    CREATE TABLE trades(
      venue TEXT,ref TEXT,asset TEXT,block_time INTEGER,block_index INTEGER,quantity REAL,currency TEXT,
      total REAL,usd_value REAL,buyer TEXT,seller TEXT,tx_hash TEXT,sale_class TEXT,PRIMARY KEY(venue,ref)
    );
  `);
  const compact = new DatabaseSync(":memory:");
  compact.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO core_state VALUES('build_complete','1'),('import_complete','1');
    INSERT INTO core_state VALUES('emblem_listings_generation','0');
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT NOT NULL UNIQUE);
    CREATE TABLE prices(day TEXT,currency TEXT,usd REAL,source TEXT,PRIMARY KEY(day,currency));
    CREATE TABLE xcp_btc_daily(day TEXT PRIMARY KEY,xcpbtc REAL);
    CREATE TABLE scarce_city_sales(asset_id INTEGER,sold_at INTEGER,price_btc REAL,PRIMARY KEY(asset_id,sold_at));
    CREATE TABLE emblem_sales(
      tx_hash TEXT,log_index INTEGER,contract_id INTEGER,token_id TEXT,price_raw TEXT,token_address_id INTEGER,
      marketplace TEXT,buyer_id INTEGER,seller_id INTEGER,block_number INTEGER,PRIMARY KEY(tx_hash,log_index)
    );
    CREATE TABLE emblem_vaults(
      token_id TEXT PRIMARY KEY,contract_id INTEGER,btc_address_id INTEGER,resolved INTEGER DEFAULT 0,first_seen INTEGER
    );
    CREATE TABLE emblem_listings(
      generation INTEGER NOT NULL,contract_id INTEGER NOT NULL,token_id TEXT NOT NULL,asset_id INTEGER,
      order_id TEXT,marketplace TEXT,price_usd REAL,price_amount TEXT,currency_id INTEGER,url TEXT,
      expiry INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(generation,contract_id,token_id)
    );
    CREATE TABLE trades(
      venue TEXT,ref TEXT,asset_id INTEGER,block_time INTEGER,block_index INTEGER,quantity REAL,currency TEXT,
      total REAL,usd_value REAL,buyer_id INTEGER,seller_id INTEGER,tx_hash BLOB,external_tx_hash TEXT,
      sale_class TEXT,PRIMARY KEY(venue,ref)
    );
    CREATE TABLE asset_feed_counts(
      asset_id INTEGER PRIMARY KEY,sales INTEGER DEFAULT 0,issuances INTEGER DEFAULT 0,
      dispensers INTEGER DEFAULT 0,dispenses INTEGER DEFAULT 0,orders INTEGER DEFAULT 0,
      sends INTEGER DEFAULT 0,fairmints INTEGER DEFAULT 0,dividends INTEGER DEFAULT 0,
      destructions INTEGER DEFAULT 0,pools INTEGER DEFAULT 0,subassets INTEGER DEFAULT 0,updated_at INTEGER);
    CREATE TABLE issuances(asset_id INTEGER); CREATE TABLE dispensers(asset_id INTEGER);
    CREATE TABLE dispenses(asset_id INTEGER); CREATE TABLE orders(give_asset_id INTEGER,get_asset_id INTEGER);
    CREATE TABLE sends(asset_id INTEGER); CREATE TABLE fairmints(asset_id INTEGER);
    CREATE TABLE dividends(asset_id INTEGER,dividend_asset_id INTEGER); CREATE TABLE destructions(asset_id INTEGER);
    CREATE TABLE pools(asset_a_id INTEGER,asset_b_id INTEGER,lp_asset TEXT); CREATE TABLE assets(asset_longname TEXT);
  `);
  return { source, compact, env: { DB: d1(source), CORE_DB: d1(compact) } };
}

test("compact Emblem identity writes converge without erasing resolved fields", async () => {
  const { compact } = databases();
  await upsertCoreEmblemVaultIdentities(d1(compact), [
    { tokenId: "7", contract: "contract", btcAddress: null, resolved: 0, firstSeen: 100 },
  ]);
  await upsertCoreEmblemVaultIdentities(d1(compact), [
    { tokenId: "7", contract: null, btcAddress: "btc", resolved: 1, firstSeen: null },
  ]);
  await upsertCoreEmblemVaultIdentities(d1(compact), [
    { tokenId: "7", contract: "contract", btcAddress: null, resolved: 0, firstSeen: 200 },
  ]);
  assert.deepEqual(
    { ...compact.prepare(
      `SELECT vault.token_id,contract.address contract,btc.address btc_address,vault.resolved,vault.first_seen
       FROM emblem_vaults vault LEFT JOIN address_dictionary contract ON contract.address_id=vault.contract_id
       LEFT JOIN address_dictionary btc ON btc.address_id=vault.btc_address_id`,
    ).get() },
    { token_id: "7", contract: "contract", btc_address: "btc", resolved: 1, first_seen: 100 },
  );
});

test("incremental projection reconciliation upserts bounded pages and dictionary identities", async () => {
  const { source, compact, env } = databases();
  source.exec(`
    INSERT INTO emblem_listings VALUES('live','contract','RAREPEPE','order','market',10,'10','currency','url',999,100);
    INSERT INTO prices VALUES('2026-07-12','BTC',100000,'coinbase');
    INSERT INTO prices VALUES('2026-07-13','BTC',101000,'coinbase');
    INSERT INTO scarce_city_sales VALUES('RAREPEPE',123,0.25);
    INSERT INTO emblem_sales VALUES('abc',1,'contract','7','10','token','market','buyer','seller',99);
    INSERT INTO trades VALUES('dex','one','RAREPEPE',10,9,2,'XCP',3,4,'buyer','seller','${"ab".repeat(32)}','clean');
    INSERT INTO trades VALUES('external','two',NULL,11,NULL,1,'USD',5,5,NULL,NULL,'provider-id','clean');
  `);
  compact.exec(`INSERT INTO prices VALUES('2026-07-12','BTC',1,'stale')`);
  compact.exec(`
    INSERT INTO address_dictionary(address) VALUES('old-contract');
    INSERT INTO emblem_listings VALUES(0,1,'stale',NULL,NULL,'market',1,'1',NULL,'old',999,1);
  `);

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

  assert.equal((await reconcileCoreProjection(env, "emblem_listings")).caught_up, true);
  assert.equal(
    compact.prepare(`SELECT value FROM core_state WHERE key='emblem_listings_generation'`).get()?.value,
    "1",
  );
  assert.deepEqual(
    compact
      .prepare(
        `SELECT a.asset,l.token_id,l.price_usd
           FROM emblem_listings l JOIN asset_dictionary a ON a.asset_id=l.asset_id
          WHERE l.generation=CAST((SELECT value FROM core_state WHERE key='emblem_listings_generation') AS INTEGER)`,
      )
      .all()
      .map((row) => ({ ...row })),
    [{ asset: "RAREPEPE", token_id: "live", price_usd: 10 }],
  );
  assert.equal(compact.prepare(`SELECT count(*) count FROM emblem_listings`).get()?.count, 2);

  source.exec(`
    DELETE FROM emblem_listings WHERE token_id='live';
    INSERT INTO emblem_listings VALUES('replacement','contract','RAREPEPE','next','market',12,'12','currency','next-url',999,101);
  `);
  assert.equal((await reconcileCoreProjection(env, "emblem_listings")).caught_up, true);
  assert.equal(
    compact.prepare(`SELECT value FROM core_state WHERE key='emblem_listings_generation'`).get()?.value,
    "2",
  );
  assert.deepEqual(
    compact
      .prepare(
        `SELECT token_id,price_usd FROM emblem_listings
          WHERE generation=CAST((SELECT value FROM core_state WHERE key='emblem_listings_generation') AS INTEGER)`,
      )
      .all()
      .map((row) => ({ ...row })),
    [{ token_id: "replacement", price_usd: 12 }],
  );
  assert.equal(compact.prepare(`SELECT count(*) count FROM emblem_listings`).get()?.count, 3);

  assert.equal((await reconcileCoreProjection(env, "trades")).caught_up, true);
  assert.deepEqual(
    compact
      .prepare(
        `SELECT venue,lower(hex(tx_hash)) tx_hash,external_tx_hash
           FROM trades ORDER BY venue`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { venue: "dex", tx_hash: "ab".repeat(32), external_tx_hash: null },
      { venue: "external", tx_hash: "", external_tx_hash: "provider-id" },
    ],
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
