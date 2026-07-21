import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { parseCounterList } from "#api/integrations/bitcoin-counters";
import { applyCounterTags } from "#api/indexer/counters";

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
    return (this.db.prepare(this.sql).get(...(this.values as never[])) as T | undefined) ?? null;
  }
  async run() {
    this.db.prepare(this.sql).run(...(this.values as never[]));
    return { meta: {} };
  }
}

function d1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

const MINT_TX = "ab".repeat(32);
const GHOST_TX = "cd".repeat(32);

test("counter list parsing keeps valid rows and drops provider drift", () => {
  const rows = parseCounterList({
    counters: [
      { number: 0, asset: "XDUALS", txid: MINT_TX, envelope: "ord", content_type: "text/plain" },
      { number: 1, asset: "BADHASH", txid: "not-a-hash" },
      { number: "2", asset: "BADNUMBER", txid: MINT_TX },
      { number: 3, asset: "MINIMAL", txid: MINT_TX },
    ],
  });
  assert.deepEqual(
    rows.map((row) => row.asset),
    ["XDUALS", "MINIMAL"],
  );
  assert.equal(rows[1]!.envelope, "unknown");
  assert.equal(rows[1]!.content_type, "application/octet-stream");
  assert.throws(() => parseCounterList({ nope: true }));
});

test("counter tags require mirror confirmation and keep the original number per asset", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE transactions(tx_index INTEGER PRIMARY KEY,tx_hash BLOB);
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,UNIQUE(entity_type,entity_key));
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,meta TEXT,PRIMARY KEY(entity_id,tag));
    INSERT INTO asset_dictionary VALUES(1,'DUALNAKA'),(2,'ORPHANTX');
  `);
  const mintHash = new Uint8Array(32).map((_, i) => Number.parseInt(MINT_TX.slice(i * 2, i * 2 + 2), 16));
  db.prepare(`INSERT INTO transactions VALUES(10,?)`).run(mintHash);

  const report = await applyCounterTags(d1(db), [
    // Two counters on one asset, listed out of order — the tag must carry the LOWER number.
    { number: 2, asset: "DUALNAKA", txid: MINT_TX, envelope: "ord", content_type: "image/gif" },
    { number: 1, asset: "DUALNAKA", txid: MINT_TX, envelope: "ord", content_type: "image/gif" },
    // In the mirror but its mint tx is not — reference row we cannot confirm.
    { number: 3, asset: "ORPHANTX", txid: GHOST_TX, envelope: "generic", content_type: "text/plain" },
    // Not a mirror asset at all.
    { number: 4, asset: "GHOSTASSET", txid: MINT_TX, envelope: "ord", content_type: "text/plain" },
  ]);

  assert.equal(report.listed, 4);
  assert.equal(report.assets, 3);
  assert.equal(report.tagged, 1);
  assert.deepEqual(report.unverified, ["ORPHANTX#3: mint tx not in mirror", "GHOSTASSET#4: asset not in mirror"]);

  const tag = db
    .prepare(
      `SELECT tag,source,meta FROM tags JOIN entity_dictionary USING(entity_id)
       WHERE entity_type='asset' AND entity_key='DUALNAKA'`,
    )
    .get() as { tag: string; source: string; meta: string };
  assert.equal(tag.tag, "counter");
  assert.equal(tag.source, "counters");
  assert.deepEqual(JSON.parse(tag.meta), { number: 1, envelope: "ord", content_type: "image/gif" });
  db.close();
});
