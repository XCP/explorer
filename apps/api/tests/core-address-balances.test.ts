import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { addresses } from "#api/read/addresses";
import {
  CORE_BALANCES_BY_ADDRESS_SQL,
  CORE_UTXO_BALANCES_BY_ADDRESS_SQL,
  listAddressBalances,
  listAddressUtxoBalances,
} from "#api/queries/core";

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
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

function fixture(detached = 0, attached = 0): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT NOT NULL UNIQUE);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,asset_longname TEXT,divisible INTEGER);
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT);
    CREATE TABLE tags(entity_id INTEGER,tag TEXT);
    CREATE TABLE balances(
      balance_id INTEGER PRIMARY KEY,address_id INTEGER,utxo_tx_hash BLOB,utxo_vout INTEGER,
      asset_id INTEGER NOT NULL,quantity TEXT NOT NULL,quantity_normalized TEXT,
      updated_block_index INTEGER,updated_event_index INTEGER NOT NULL DEFAULT 0,utxo_address_id INTEGER
    );
    CREATE UNIQUE INDEX idx_balances_address_asset ON balances(address_id,asset_id) WHERE address_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_balances_utxo_asset ON balances(utxo_tx_hash,utxo_vout,asset_id) WHERE utxo_tx_hash IS NOT NULL;
    CREATE INDEX idx_balances_utxo_address ON balances(utxo_address_id) WHERE utxo_address_id IS NOT NULL;
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob');
  `);
  const insertAsset = db.prepare("INSERT INTO asset_dictionary VALUES(?,?)");
  const insertFacts = db.prepare("INSERT INTO assets VALUES(?,?,?)");
  const insertDetached = db.prepare(
    "INSERT INTO balances(balance_id,address_id,asset_id,quantity,quantity_normalized,updated_block_index) VALUES(?,1,?,'1','1',900000)",
  );
  const insertAttached = db.prepare(
    "INSERT INTO balances(balance_id,utxo_tx_hash,utxo_vout,asset_id,quantity,quantity_normalized,updated_block_index,utxo_address_id) VALUES(?,unhex(?),?,?, '1','1',900001,1)",
  );
  const count = Math.max(detached, attached);
  db.exec("BEGIN");
  for (let i = 1; i <= count; i++) {
    insertAsset.run(i, `A${String(i).padStart(7, "0")}`);
    insertFacts.run(i, i === 1 ? "PARENT.CARD" : null, i % 2);
    if (i <= detached) insertDetached.run(i, i);
    if (i <= attached) {
      const txid = i.toString(16).padStart(64, "0");
      insertAttached.run(detached + i, txid, i % 3, i);
    }
  }
  db.exec("COMMIT");
  return db;
}

async function exhaust<T>(read: (limit: number, offset: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await read(100, offset);
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

test("address balance modes paginate thousands of rows without drops or duplicates", async () => {
  const binding = d1(fixture(2_000, 5_000));
  const detached = await exhaust((limit, offset) => listAddressBalances(binding, "alice", limit, offset));
  const attached = await exhaust((limit, offset) => listAddressUtxoBalances(binding, "alice", limit, offset));
  assert.equal(detached.length, 2_000);
  assert.equal(attached.length, 5_000);
  assert.equal(new Set(detached.map((row) => row.asset)).size, detached.length);
  assert.equal(new Set(attached.map((row) => `${row.utxo} ${row.asset}`)).size, attached.length);
  assert.equal(
    attached.every((row) => row.utxo_address === "alice"),
    true,
  );
  assert.equal(
    attached.every((row) => /^[0-9a-f]{64}:\d+$/.test(row.utxo)),
    true,
  );
  assert.equal(attached[0]?.quantity, "1");
  assert.equal(attached[0]?.updated_block_index, 900001);
});

test("UTXO mode preserves several assets on one outpoint and one asset on several outpoints", async () => {
  const db = fixture(0, 2);
  db.prepare("UPDATE balances SET utxo_tx_hash=unhex(?),utxo_vout=7 WHERE balance_id IN (1,2)").run("f".repeat(64));
  db.prepare(
    "INSERT INTO balances(balance_id,utxo_tx_hash,utxo_vout,asset_id,quantity,quantity_normalized,utxo_address_id) VALUES(3,unhex(?),8,1,'1','1',1)",
  ).run("e".repeat(64));
  const rows = await listAddressUtxoBalances(d1(db), "alice", 10, 0);
  assert.equal(rows.filter((row) => row.utxo === `${"f".repeat(64)}:7`).length, 2);
  assert.equal(rows.filter((row) => row.asset === "A0000001").length, 2);
});

test("balance route defaults to address mode and rejects unknown modes", async () => {
  const binding = d1(fixture(1, 1));
  const env = { CORE_DB: binding } as never;
  const addressResponse = await addresses.request("/v2/addresses/alice/balances?limit=100", undefined, env);
  assert.equal(addressResponse.status, 200);
  const addressBody = (await addressResponse.json()) as {
    result: Array<{ asset: string }>;
    next_offset: number | null;
  };
  assert.equal(addressBody.result.length, 1);
  assert.equal(addressBody.next_offset, null);

  const utxoResponse = await addresses.request("/v2/addresses/alice/balances?type=utxo&limit=100", undefined, env);
  assert.equal(utxoResponse.status, 200);
  assert.equal(((await utxoResponse.json()) as { result: unknown[] }).result.length, 1);

  const invalid = await addresses.request("/v2/addresses/alice/balances?type=all", undefined, env);
  assert.equal(invalid.status, 400);
});

test("both balance modes use their holder indexes", () => {
  const db = fixture(1, 1);
  const addressPlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_BALANCES_BY_ADDRESS_SQL}`).all(1, 10, 0) as {
    detail: string;
  }[];
  const utxoPlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_UTXO_BALANCES_BY_ADDRESS_SQL}`).all(1, 10, 0) as {
    detail: string;
  }[];
  assert.equal(
    addressPlan.some((row) => row.detail.includes("idx_balances_address_asset")),
    true,
  );
  assert.equal(
    utxoPlan.some((row) => row.detail.includes("idx_balances_utxo_address")),
    true,
  );
});
