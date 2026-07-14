import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { upsertEmblemVaultIdentities } from "#api/indexer/emblem";
import { upsertEmblemListingContract } from "#api/indexer/emblem-listings";
import { priceOf, upsertEmblemSales } from "#api/indexer/emblem-sales";

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
    INSERT INTO core_state VALUES('emblem_listings_generation','0');
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT NOT NULL UNIQUE);
    CREATE TABLE prices(day TEXT,currency TEXT,usd REAL,source TEXT,PRIMARY KEY(day,currency));
    CREATE TABLE xcp_btc_daily(day TEXT PRIMARY KEY,xcpbtc REAL);
    CREATE TABLE scarce_city_sales(asset_id INTEGER,sold_at INTEGER,price_btc REAL,PRIMARY KEY(asset_id,sold_at));
    CREATE TABLE emblem_sales(
      tx_hash TEXT,log_index INTEGER,contract_id INTEGER,token_id TEXT,price_raw TEXT,token_address_id INTEGER,
      marketplace TEXT,buyer_id INTEGER,seller_id INTEGER,block_number INTEGER,
      PRIMARY KEY(tx_hash,log_index,contract_id,token_id)
    );
    CREATE TABLE emblem_vaults(
      contract_id INTEGER,token_id TEXT,btc_address_id INTEGER,resolved INTEGER DEFAULT 0,first_seen INTEGER,
      PRIMARY KEY(contract_id,token_id)
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
  await upsertEmblemVaultIdentities(d1(compact), [
    { tokenId: "7", contract: "contract", btcAddress: null, resolved: 0, firstSeen: 100 },
  ]);
  await upsertEmblemVaultIdentities(d1(compact), [
    { tokenId: "7", contract: "contract", btcAddress: "btc", resolved: 1, firstSeen: null },
  ]);
  await upsertEmblemVaultIdentities(d1(compact), [
    { tokenId: "7", contract: "contract", btcAddress: null, resolved: 0, firstSeen: 200 },
    { tokenId: "7", contract: "other-contract", btcAddress: "other-btc", resolved: 1, firstSeen: 300 },
  ]);
  assert.deepEqual(
    compact
      .prepare(
        `SELECT vault.token_id,contract.address contract,btc.address btc_address,vault.resolved,vault.first_seen
       FROM emblem_vaults vault LEFT JOIN address_dictionary contract ON contract.address_id=vault.contract_id
       LEFT JOIN address_dictionary btc ON btc.address_id=vault.btc_address_id ORDER BY contract.address`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { token_id: "7", contract: "contract", btc_address: "btc", resolved: 1, first_seen: 100 },
      { token_id: "7", contract: "other-contract", btc_address: "other-btc", resolved: 1, first_seen: 300 },
    ],
  );
});

test("compact Emblem sales preserve exact prices and converge provider corrections", async () => {
  const { compact } = databases();
  assert.deepEqual(
    priceOf({
      sellerFee: { amount: "9007199254740993" },
      protocolFee: { amount: "7", tokenAddress: "0xTOKEN" },
    }),
    { raw: "9007199254741000", token: "0xtoken" },
  );
  await upsertEmblemSales(d1(compact), [
    {
      transactionHash: "0xabc",
      logIndex: 1,
      contract: "contract",
      tokenId: "7",
      priceRaw: "10",
      tokenAddress: "eth",
      marketplace: "old",
      buyer: "buyer",
      seller: "seller",
      blockNumber: 99,
    },
  ]);
  await upsertEmblemSales(d1(compact), [
    {
      transactionHash: "0xabc",
      logIndex: 1,
      contract: "contract",
      tokenId: "8",
      priceRaw: "12",
      tokenAddress: "eth",
      marketplace: "corrected",
      buyer: "buyer",
      seller: null,
      blockNumber: 100,
    },
  ]);
  await upsertEmblemSales(d1(compact), [
    {
      transactionHash: "0xabc",
      logIndex: 1,
      contract: "contract",
      tokenId: "7",
      priceRaw: "12",
      tokenAddress: "eth",
      marketplace: "corrected",
      buyer: "buyer",
      seller: null,
      blockNumber: 100,
    },
  ]);
  assert.deepEqual(
    compact
      .prepare(
        `SELECT sale.token_id,sale.price_raw,sale.marketplace,sale.block_number,contract.address contract,
            token.address token,buyer.address buyer,seller.address seller
       FROM emblem_sales sale
       JOIN address_dictionary contract ON contract.address_id=sale.contract_id
       JOIN address_dictionary token ON token.address_id=sale.token_address_id
       LEFT JOIN address_dictionary buyer ON buyer.address_id=sale.buyer_id
       LEFT JOIN address_dictionary seller ON seller.address_id=sale.seller_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        token_id: "7",
        price_raw: "12",
        marketplace: "corrected",
        block_number: 100,
        contract: "contract",
        token: "eth",
        buyer: "buyer",
        seller: null,
      },
      {
        token_id: "8",
        price_raw: "12",
        marketplace: "corrected",
        block_number: 100,
        contract: "contract",
        token: "eth",
        buyer: "buyer",
        seller: null,
      },
    ],
  );
});

test("compact listing generations converge asks and remove observed delistings", async () => {
  const { compact } = databases();
  compact.exec(`
    INSERT INTO address_dictionary(address) VALUES('contract');
    INSERT INTO asset_dictionary(asset) VALUES('RAREPEPE');
  `);
  const assetId = compact.prepare(`SELECT asset_id FROM asset_dictionary WHERE asset='RAREPEPE'`).get()
    ?.asset_id as number;
  const ask = (tokenId: string, priceUsd: number) => ({
    tokenId,
    orderId: `order-${tokenId}`,
    marketplace: "market",
    priceUsd,
    priceAmount: String(priceUsd),
    currency: "eth",
    expiry: 999,
    assetId,
  });
  await upsertEmblemListingContract(d1(compact), 1, "contract", [ask("7", 10), ask("8", 20)], 100);
  await upsertEmblemListingContract(d1(compact), 1, "contract", [ask("8", 22)], 101);
  assert.deepEqual(
    compact
      .prepare(`SELECT token_id,price_usd,updated_at FROM emblem_listings ORDER BY token_id`)
      .all()
      .map((row) => ({ ...row })),
    [{ token_id: "8", price_usd: 22, updated_at: 101 }],
  );
});
