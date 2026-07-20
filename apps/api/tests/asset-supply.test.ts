import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Env } from "#api/env";
import { crawlAssetSupply, enqueueCoreSupply, SUPPLY_ID_LOOKUP_BATCH } from "#api/indexer/asset-supply";

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

function d1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

test("supply queue chunks identity lookups below D1's SQL-variable ceiling", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE NOT NULL)`);
  const insert = sqlite.prepare(`INSERT INTO asset_dictionary VALUES(?,?)`);
  const names = Array.from({ length: SUPPLY_ID_LOOKUP_BATCH * 3 + 1 }, (_, index) => `ASSET${index}`);
  names.forEach((name, index) => insert.run(index + 1, name));

  await enqueueCoreSupply(d1(sqlite), names);

  const queue = JSON.parse(
    String(sqlite.prepare(`SELECT value FROM core_state WHERE key='asset_supply_queue'`).get()?.value),
  );
  assert.equal(queue.length, names.length);
  assert.deepEqual(
    [...queue].sort((a: number, b: number) => a - b),
    names.map((_, index) => index + 1),
  );
});

test("compact supply maintenance is exact, queued by identity, and updates derived protocol totals", async () => {
  assert.ok(SUPPLY_ID_LOOKUP_BATCH < 100, "D1 identity lookups must stay below its SQL-variable ceiling");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE NOT NULL);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,divisible INTEGER NOT NULL,supply TEXT,supply_normalized TEXT);
    CREATE TABLE blocks(block_index INTEGER PRIMARY KEY);
    CREATE TABLE issuances(asset_id INTEGER,quantity TEXT,fee_paid TEXT,status TEXT);
    CREATE TABLE destructions(asset_id INTEGER,quantity TEXT,status TEXT);
    CREATE TABLE burns(earned TEXT,status TEXT);
    CREATE TABLE dividends(fee_paid TEXT,status TEXT);
    CREATE TABLE sweeps(fee_paid TEXT,status TEXT);
    CREATE TABLE fairminters(tx_index INTEGER PRIMARY KEY,earned_quantity TEXT,paid_quantity TEXT);
    CREATE TABLE fairmints(fairminter_tx_index INTEGER,earn_quantity TEXT,paid_quantity TEXT,status TEXT);
    CREATE TABLE pools(lp_asset TEXT,reserve_a TEXT,reserve_b TEXT,lp_supply TEXT,price REAL);
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'A');
    INSERT INTO assets VALUES(1,1,NULL,NULL),(2,0,NULL,NULL);
    INSERT INTO blocks VALUES(100);
    INSERT INTO issuances VALUES(2,'100','3','valid'),(2,'50',NULL,'valid'),(2,'999',NULL,'invalid');
    INSERT INTO destructions VALUES(2,'20','valid'),(1,'5','valid');
    INSERT INTO burns VALUES('1000','valid');
    INSERT INTO dividends VALUES('7','valid');
    INSERT INTO sweeps VALUES('11','valid');
    INSERT INTO fairminters VALUES(10,NULL,NULL);
    INSERT INTO fairmints VALUES(10,'5','2','valid'),(10,'7','3','valid'),(10,'99','99','invalid');
    INSERT INTO pools VALUES('A','10','30',NULL,NULL);
    INSERT INTO core_state VALUES('asset_supply_done','1');
  `);
  const core = d1(sqlite);
  await enqueueCoreSupply(core, ["A", "A", "missing"]);
  assert.equal(sqlite.prepare(`SELECT value FROM core_state WHERE key='asset_supply_queue'`).get()?.value, "[2]");

  const result = await crawlAssetSupply({ CORE_DB: core } as Env);
  assert.deepEqual(result, {
    phase: "maintenance",
    recomputed: 1,
    queue_remaining: 0,
    fairminters: 1,
    pools: 1,
  });
  assert.deepEqual(
    sqlite
      .prepare(`SELECT asset_id,supply,supply_normalized FROM assets ORDER BY asset_id`)
      .all()
      .map((row) => ({ ...row })),
    [
      { asset_id: 1, supply: "974", supply_normalized: "0.00000974" },
      { asset_id: 2, supply: "130", supply_normalized: "130" },
    ],
  );
  assert.deepEqual(
    { ...sqlite.prepare(`SELECT earned_quantity,paid_quantity FROM fairminters`).get() },
    {
      earned_quantity: "12",
      paid_quantity: "5",
    },
  );
  assert.deepEqual({ ...sqlite.prepare(`SELECT lp_supply,price FROM pools`).get() }, { lp_supply: "130", price: 3 });
});
