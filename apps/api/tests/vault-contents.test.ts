import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { classifyVaults } from "#api/indexer/vault-contents";

class Statement {
  private args: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.args) as T[] };
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { meta: { rows_written: result.changes } };
  }
}

const d1 = (db: DatabaseSync): D1Database =>
  ({
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => Promise.all(statements.map((statement) => statement.run())),
  }) as unknown as D1Database;

test("vault classification derives compact identities, contents, and crack recipient", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE emblem_vaults(
      contract_id INTEGER,token_id TEXT,btc_address_id INTEGER,contents_asset_id INTEGER,contents_qty REAL,
      vault_kind TEXT,funded INTEGER DEFAULT 0,cracked_at INTEGER,cracker_address_id INTEGER,
      classified INTEGER DEFAULT 0,PRIMARY KEY(contract_id,token_id));
    CREATE TABLE sends(
      event_index INTEGER,source_address_id INTEGER,destination_address_id INTEGER,asset_id INTEGER,
      quantity TEXT,quantity_normalized TEXT,block_time INTEGER);
    CREATE TABLE balances(address_id INTEGER,asset_id INTEGER,quantity TEXT,quantity_normalized TEXT);
    CREATE TABLE sweeps(source_id INTEGER,destination_id INTEGER,block_time INTEGER);
    INSERT INTO address_dictionary VALUES
      (10,'vault-single'),(11,'vault-multi'),(12,'vault-foreign'),(20,'funder'),(30,'cracker'),(40,'contract');
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'CARD'),(3,'OTHER');
    INSERT INTO emblem_vaults(contract_id,token_id,btc_address_id) VALUES(40,'1',10),(40,'2',11),(40,'3',12);
    INSERT INTO sends VALUES
      (1,20,10,2,'200000000','2',100),
      (2,10,30,2,'200000000','2',200),
      (3,20,11,2,'100000000','1',100),
      (4,20,11,3,'100000000','1',101);
  `);
  const result = await classifyVaults({ CORE_DB: d1(sqlite) } as never);
  assert.equal(result.classified, 3);
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT vault.token_id,vault.vault_kind,vault.funded,asset.asset contents_asset,vault.contents_qty,
           vault.cracked_at,cracker.address cracker
         FROM emblem_vaults vault
         LEFT JOIN asset_dictionary asset ON asset.asset_id=vault.contents_asset_id
         LEFT JOIN address_dictionary cracker ON cracker.address_id=vault.cracker_address_id
         ORDER BY vault.token_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        token_id: "1",
        vault_kind: "single",
        funded: 1,
        contents_asset: "CARD",
        contents_qty: 2,
        cracked_at: 200,
        cracker: "cracker",
      },
      {
        token_id: "2",
        vault_kind: "multi",
        funded: 1,
        contents_asset: null,
        contents_qty: null,
        cracked_at: null,
        cracker: null,
      },
      {
        token_id: "3",
        vault_kind: "foreign",
        funded: 0,
        contents_asset: null,
        contents_qty: null,
        cracked_at: null,
        cracker: null,
      },
    ],
  );
  sqlite.close();
});
