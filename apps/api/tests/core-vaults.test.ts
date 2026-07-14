import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  vaultSummary,vaultSalesByClass,vaultTopSoldAssets,vaultTopAssets,
  vaultTopFunders,vaultTopCrackers,vaultSalesActivity,
} from "#api/queries/vaults";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact vault dashboard derives custody, participants, and market activity", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,asset_longname TEXT);
    CREATE TABLE emblem_vaults(
      token_id TEXT PRIMARY KEY,btc_address_id INTEGER,vault_kind TEXT,is_scam_shell INTEGER
    );
    CREATE TABLE balances(address_id INTEGER,asset_id INTEGER,quantity TEXT);
    CREATE TABLE sends(event_index INTEGER PRIMARY KEY,source_id INTEGER,destination_id INTEGER);
    CREATE TABLE trades(
      venue TEXT,asset_id INTEGER,usd_value REAL,sale_class TEXT,block_time INTEGER
    );
    INSERT INTO address_dictionary VALUES(1,'vault'),(2,'funder'),(3,'cracker');
    INSERT INTO asset_dictionary VALUES(1,'CARD');
    INSERT INTO assets VALUES(1,'PARENT.CARD');
    INSERT INTO emblem_vaults VALUES('1',1,'single',0),('2',NULL,'foreign',1);
    INSERT INTO balances VALUES(1,1,'1');
    INSERT INTO sends VALUES(1,2,1),(2,1,3);
    INSERT INTO trades VALUES
      ('emblem',1,100,'real',1609459200),('emblem',NULL,20,'bundle',1609459201),
      ('emblem',NULL,5,'scam_empty',1609459202);
  `);
  const dbBinding = d1(db);

  assert.deepEqual({ ...(await vaultSummary(dbBinding)) }, {
    total_vaults: 2,counterparty_vaults: 1,foreign_vaults: 1,funded_vaults: 1,
    scam_shells: 1,sales: 3,realized_usd: 120,
  });
  assert.equal((await vaultSalesByClass(dbBinding))[0].sale_class, "real");
  assert.deepEqual({ ...(await vaultTopSoldAssets(dbBinding))[0] }, {
    asset: "CARD",asset_longname: "PARENT.CARD",usd: 100,sales: 1,
  });
  assert.deepEqual({ ...(await vaultTopAssets(dbBinding))[0] }, {
    asset: "CARD",asset_longname: "PARENT.CARD",vaults: 1,
  });
  assert.deepEqual({ ...(await vaultTopFunders(dbBinding))[0] }, { address: "funder",vaults: 1 });
  assert.deepEqual({ ...(await vaultTopCrackers(dbBinding))[0] }, { address: "cracker",vaults: 1 });
  assert.deepEqual(await vaultSalesActivity(dbBinding), [{ t: 1609459200,v: 120 }]);
});
