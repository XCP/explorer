import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Env } from "#api/env";
import { CORE_RECENT_PROJECTIONS, reconcileRecentCoreProjection } from "#api/indexer/core-projections";

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
    this.db.prepare(this.sql).run(...this.values);
    return { success: true };
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

test("transition reconciliation cannot overwrite compact-owned projections", async () => {
  assert.deepEqual([...CORE_RECENT_PROJECTIONS], ["address_signals"]);
  const source = new DatabaseSync(":memory:");
  const compact = new DatabaseSync(":memory:");
  source.exec(`
    CREATE TABLE address_signals(address TEXT PRIMARY KEY,first_block INTEGER);
    INSERT INTO address_signals VALUES('one',10),('two',20);
  `);
  compact.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO core_state VALUES('seed_block_index','100');
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY,first_block INTEGER,last_block INTEGER DEFAULT 0,
      out_peers INTEGER DEFAULT 0,in_peers INTEGER DEFAULT 0,dispense_btc REAL DEFAULT 0,dispenses INTEGER DEFAULT 0,
      dividends INTEGER DEFAULT 0,assets_issued INTEGER DEFAULT 0,locked_assets INTEGER DEFAULT 0,btc_spent REAL DEFAULT 0,
      btc_fees REAL DEFAULT 0,assets_held INTEGER DEFAULT 0,assets_received INTEGER DEFAULT 0,survived_assets INTEGER DEFAULT 0,
      assets_distributed INTEGER DEFAULT 0,assets_hits INTEGER DEFAULT 0,rep_score REAL DEFAULT 1,clean_dispense_btc REAL DEFAULT 0,
      clean_btc_spent REAL DEFAULT 0,is_exchange INTEGER DEFAULT 0,is_deposit INTEGER DEFAULT 0,is_burn INTEGER DEFAULT 0,
      assets_burned INTEGER DEFAULT 0,disp_trust REAL DEFAULT 0,is_emblem_vault INTEGER DEFAULT 0,likely_service INTEGER DEFAULT 0,
      dex_trades INTEGER DEFAULT 0,stamps_created INTEGER DEFAULT 0,stamps_collected INTEGER DEFAULT 0,src20_deploys INTEGER DEFAULT 0,
      is_btns_user INTEGER DEFAULT 0,graph_trust REAL DEFAULT 0,graph_distrust REAL DEFAULT 0,vault_scams INTEGER DEFAULT 0,
      shell_scams INTEGER DEFAULT 0,dump_scams INTEGER DEFAULT 0);
    INSERT INTO address_dictionary VALUES(1,'one');
    INSERT INTO address_signals(address_id,first_block) VALUES(1,10);
  `);
  const result = await reconcileRecentCoreProjection(
    { DB: d1(source), CORE_DB: d1(compact) } as Pick<Env, "DB" | "CORE_DB">,
    "address_signals",
  );
  assert.equal(result.processed, 1);
  assert.deepEqual(
    compact
      .prepare(
        `SELECT dictionary.address,signal.first_block FROM address_signals signal
        JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id ORDER BY signal.address_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { address: "one", first_block: 10 },
      { address: "two", first_block: 20 },
    ],
  );
});
