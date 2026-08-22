import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { holderMakeup } from "#api/queries/assets";

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
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

const d1 = (db: DatabaseSync) =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE balances(address_id INTEGER,asset_id INTEGER,quantity TEXT);
    CREATE TABLE address_signals(
      address_id INTEGER PRIMARY KEY,is_exchange INTEGER,is_deposit INTEGER,is_emblem_vault INTEGER,is_burn INTEGER,
      survived_assets INTEGER,assets_held INTEGER,vault_scams INTEGER,shell_scams INTEGER,dump_scams INTEGER
    );
    CREATE TABLE address_reputations(address_id INTEGER PRIMARY KEY,reputation REAL);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY,top1_pct REAL);
    INSERT INTO asset_dictionary VALUES(10,'CARD'),(11,'EMPTY');
    INSERT INTO address_signals VALUES
      (1,0,0,0,0,20,600,0,0,0),
      (2,1,0,0,0,0,2,0,0,0);
    INSERT INTO address_reputations VALUES(1,99),(2,80);
    INSERT INTO balances VALUES(1,10,'60'),(2,10,'40'),(2,11,'0');
    INSERT INTO asset_signals VALUES(10,60.04),(11,0);
  `);
  return db;
}

test("holder makeup shares one holder projection without changing its classifications", async () => {
  const result = await holderMakeup(d1(fixture()), "CARD");
  assert.deepEqual(result, {
    tiers: [
      { tier: "Exceptional", holders: 1, pct_supply: 60 },
      { tier: "Exchange", holders: 1, pct_supply: 40 },
    ],
    archetypes: { creators: 1, whales: 1, collectors: 1, holders: 2 },
    top_holder_pct: 60,
  });
});

test("holder makeup returns an empty factual projection for an asset without holders", async () => {
  const result = await holderMakeup(d1(fixture()), "EMPTY");
  assert.deepEqual(result, {
    tiers: [],
    archetypes: { creators: 0, whales: 0, collectors: 0, holders: 0 },
    top_holder_pct: 0,
  });
});
