import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  ADDRESS_REPUTATION_RECONCILE_SQL,
  ADDRESS_REPUTATION_UPSERT_SQL,
  addressReputationState,
  addressReputationTier,
} from "#api/indexer/address-reputation";
import { percentile, scoreConviction } from "#api/reputation/score";

test("Address Reputation is an equal-family population rank with deterministic bands", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_signals(
      address_id INTEGER PRIMARY KEY,first_block INTEGER,last_block INTEGER,
      survived_assets INTEGER DEFAULT 0,dividends INTEGER DEFAULT 0,locked_assets INTEGER DEFAULT 0,
      btc_fees REAL DEFAULT 0,clean_btc_spent REAL DEFAULT 0,clean_dispense_btc REAL DEFAULT 0,
      assets_held INTEGER DEFAULT 0,dex_trades INTEGER DEFAULT 0,stamps_created INTEGER DEFAULT 0,
      is_exchange INTEGER DEFAULT 0,is_deposit INTEGER DEFAULT 0,is_burn INTEGER DEFAULT 0,
      is_emblem_vault INTEGER DEFAULT 0,likely_service INTEGER DEFAULT 0,
      vault_scams INTEGER DEFAULT 0,shell_scams INTEGER DEFAULT 0,dump_scams INTEGER DEFAULT 0
    );
    CREATE TABLE address_reputations(
      address_id INTEGER PRIMARY KEY,reputation REAL,rank_position INTEGER,population INTEGER,
      duration_score REAL,creation_score REAL,economic_score REAL,participation_score REAL,
      calculated_at INTEGER,model_version INTEGER
    );
    INSERT INTO address_signals(address_id,first_block,last_block,assets_held) VALUES
      (1,100,100,1),(2,100,200,10),(3,100,300,100);
  `);
  db.prepare(ADDRESS_REPUTATION_UPSERT_SQL).run(123);
  const rows = db
    .prepare(`SELECT address_id,reputation,rank_position,population FROM address_reputations ORDER BY address_id`)
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { address_id: 1, reputation: 0, rank_position: 3, population: 3 },
    { address_id: 2, reputation: 50, rank_position: 2, population: 3 },
    { address_id: 3, reputation: 100, rank_position: 1, population: 3 },
  ]);
  assert.equal(addressReputationTier(99), "Exceptional");
  assert.equal(addressReputationTier(90), "Strong");
  assert.equal(addressReputationTier(50), "Established");
  assert.equal(addressReputationTier(49.99), "Limited");
});

test("infrastructure and integrity are classified instead of ranked", () => {
  assert.equal(addressReputationState({ reputation: 100, is_exchange: 1 }), "exchange");
  assert.equal(addressReputationState({ reputation: 100, is_deposit: 1 }), "deposit");
  assert.equal(addressReputationState({ reputation: 100, is_emblem_vault: 1 }), "vault");
  assert.equal(addressReputationState({ reputation: 100, is_burn: 1 }), "burn");
  assert.equal(addressReputationState({ reputation: 100, likely_service: 1 }), "ranked");
  assert.equal(addressReputationState({ reputation: 100, dump_scams: 1 }), "integrity");
  assert.equal(addressReputationState({ reputation: null }), "unrated");
  assert.equal(addressReputationState({ reputation: 0 }), "ranked");
});

test("reconciliation removes addresses that no longer satisfy the comparison contract", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_signals(
      address_id INTEGER PRIMARY KEY,first_block INTEGER,last_block INTEGER,survived_assets INTEGER,
      dividends INTEGER,locked_assets INTEGER,btc_fees REAL,clean_btc_spent REAL,clean_dispense_btc REAL,
      assets_held INTEGER,dex_trades INTEGER,stamps_created INTEGER,is_exchange INTEGER,is_deposit INTEGER,
      is_burn INTEGER,is_emblem_vault INTEGER,likely_service INTEGER,vault_scams INTEGER,shell_scams INTEGER,
      dump_scams INTEGER
    );
    CREATE TABLE address_reputations(address_id INTEGER PRIMARY KEY);
    INSERT INTO address_signals VALUES(1,1,2,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0);
    INSERT INTO address_reputations VALUES(1);
  `);
  db.exec(ADDRESS_REPUTATION_RECONCILE_SQL);
  const remaining = db.prepare(`SELECT COUNT(*) n FROM address_reputations`).get() as { n: number };
  assert.equal(remaining.n, 0);
});

test("Conviction remains separate, scarcity-aware, and fails closed on integrity", () => {
  assert.deepEqual(scoreConviction({ low_quality: 1, supply: 10, holders: 20 }), { raw: 0, breakdown: {} });
  const ordinary = scoreConviction({ low_quality: 0, supply: 100, burned_pct: 0, holders: 20 });
  assert.ok(Number.isFinite(ordinary.raw));
  assert.ok("scarcity" in ordinary.breakdown);
  assert.equal(percentile(5, { floor: 0, p50: 5, p90: 10, p99: 20, max: 30 }), 50);
});
