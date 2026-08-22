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
    CREATE TABLE blocks(block_index INTEGER PRIMARY KEY);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE emblem_vaults(
      contract_id INTEGER,token_id TEXT,btc_address_id INTEGER,contents_asset_id INTEGER,contents_qty REAL,
      vault_kind TEXT,funded INTEGER DEFAULT 0,cracked_at INTEGER,cracker_address_id INTEGER,
      classified INTEGER DEFAULT 0,PRIMARY KEY(contract_id,token_id));
    CREATE TABLE emblem_vault_contents_dirty(
      contract_id INTEGER,token_id TEXT,PRIMARY KEY(contract_id,token_id)) WITHOUT ROWID;
    CREATE TABLE sends(
      event_index INTEGER,source_id INTEGER,destination_id INTEGER,source_address_id INTEGER,
      destination_address_id INTEGER,asset_id INTEGER,quantity TEXT,quantity_normalized TEXT,
      block_index INTEGER,block_time INTEGER);
    CREATE INDEX idx_sends_source ON sends(source_id,block_index DESC,event_index DESC);
    CREATE INDEX idx_sends_destination ON sends(destination_id,block_index DESC,event_index DESC);
    CREATE INDEX idx_sends_source_address ON sends(source_address_id,block_index DESC,event_index DESC)
      WHERE source_address_id IS NOT NULL;
    CREATE INDEX idx_sends_destination_address ON sends(destination_address_id,block_index DESC,event_index DESC)
      WHERE destination_address_id IS NOT NULL;
    CREATE TABLE balances(address_id INTEGER,asset_id INTEGER,quantity TEXT,quantity_normalized TEXT);
    CREATE TABLE sweeps(source_id INTEGER,destination_id INTEGER,block_time INTEGER);
    INSERT INTO address_dictionary VALUES
      (10,'vault-single'),(11,'vault-multi'),(12,'vault-foreign'),(20,'funder'),(30,'cracker'),(40,'contract');
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'CARD'),(3,'OTHER');
    INSERT INTO emblem_vaults(contract_id,token_id,btc_address_id) VALUES(40,'1',10),(40,'2',11),(40,'3',12);
    INSERT INTO emblem_vault_contents_dirty VALUES(40,'1'),(40,'2'),(40,'3');
    INSERT INTO blocks VALUES(100);
    INSERT INTO sends VALUES
      (1,20,10,NULL,NULL,2,'200000000','2',1,100),
      (2,10,30,NULL,NULL,2,'200000000','2',2,200),
      (3,20,11,NULL,NULL,2,'100000000','1',1,100),
      (4,20,11,NULL,NULL,3,'100000000','1',1,101),
      (5,20,99,NULL,10,2,'100000000','1',1,110),
      (6,99,99,10,30,2,'100000000','1',3,190);
  `);
  const result = await classifyVaults({ CORE_DB: d1(sqlite) } as never);
  assert.equal(result.classified, 3);
  assert.equal(result.source, "dirty");
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) count FROM emblem_vault_contents_dirty`).get() as { count: number }).count,
    0,
  );
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
        contents_qty: 3,
        cracked_at: 190,
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

  sqlite.prepare(`UPDATE blocks SET block_index=106`).run();
  const reconcile = await classifyVaults({ CORE_DB: d1(sqlite) } as never);
  assert.equal(reconcile.source, "reconcile");
  assert.equal(reconcile.classified, 3);
  const gated = await classifyVaults({ CORE_DB: d1(sqlite) } as never);
  assert.equal(gated.idle, true);

  sqlite.prepare(`INSERT INTO emblem_vault_contents_dirty VALUES(40,'1')`).run();
  const priority = await classifyVaults({ CORE_DB: d1(sqlite) } as never);
  assert.equal(priority.source, "dirty");
  assert.equal(priority.classified, 1);
  sqlite.close();
});
