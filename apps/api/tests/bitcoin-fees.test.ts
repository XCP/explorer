import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  FEE_FETCH_CONCURRENCY,
  FEE_TIP_WATERMARK_KEY,
  FEE_WALK_CURSOR_KEY,
  FEES_PER_RUN,
  reconcileStagedBitcoinFees,
  validBitcoinFeeRows,
} from "#api/indexer/bitcoin-fees";

const txHash = "1db7a85e9bbbcd9f60a62411e94f1ae8d3851642d0e3ca73e095d522bf234293";

test("accepts exact non-negative satoshi fees", () => {
  assert.deepEqual(validBitcoinFeeRows([{ tx_hash: txHash.toUpperCase(), fee: 46_970 }]), [
    { tx_hash: txHash, fee: 46_970 },
  ]);
  assert.deepEqual(validBitcoinFeeRows([{ tx_hash: txHash, fee: 0 }]), [{ tx_hash: txHash, fee: 0 }]);
});

test("rejects malformed fee batches", () => {
  assert.equal(validBitcoinFeeRows([]), null);
  assert.equal(validBitcoinFeeRows([{ tx_hash: txHash, fee: -1 }]), null);
  assert.equal(validBitcoinFeeRows([{ tx_hash: txHash, fee: 1.5 }]), null);
  assert.equal(validBitcoinFeeRows([{ tx_hash: "not-a-hash", fee: 1 }]), null);
});

test("scheduled fee maintenance stays within the provider's smoothed budget", () => {
  assert.equal(FEE_FETCH_CONCURRENCY, 3);
  assert.equal(FEES_PER_RUN, 300);
});

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));

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
    this.db.prepare(this.sql).run(...(this.values as never[]));
    return { success: true };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.values as never[])) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[] };
  }
}

const d1 = (db: DatabaseSync) =>
  ({
    prepare: (sql: string) => new Statement(db, sql),
    batch: (statements: Statement[]) => Promise.all(statements.map((statement) => statement.all())),
  }) as unknown as D1Database;

const hashOf = (index: number) => index.toString(16).padStart(64, "0");

function seed(count: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  const insert = db.prepare(
    `INSERT INTO transactions(tx_index,tx_hash,block_index,block_time,supported) VALUES(?,?,?,?,1)`,
  );
  for (let index = 1; index <= count; index++) insert.run(index, Buffer.from(hashOf(index), "hex"), index, index * 600);
  return db;
}

const state = (db: DatabaseSync, key: string) =>
  (db.prepare(`SELECT value FROM core_state WHERE key=?`).get(key) as { value: string } | undefined)?.value ?? null;
const missing = (db: DatabaseSync) =>
  (db.prepare(`SELECT COUNT(*) n FROM transactions WHERE fee IS NULL`).get() as { n: number }).n;

/** Electrs-like provider: even indexes resolve, odd indexes are witness-hash rows that 404 forever. */
const provider = (calls: string[]) => async (_base: string, hash: string) => {
  calls.push(hash);
  const index = Number.parseInt(hash, 16);
  return index % 2 === 0 ? index * 10 : null;
};

test("the historical walk resumes from its cursor instead of re-requesting unresolvable rows", async () => {
  const db = seed(12);
  const env = { CORE_DB: d1(db), ELECTRS_API_BASE: "https://electrs.test" };
  const calls: string[] = [];

  const first = await reconcileStagedBitcoinFees(env, 4, provider(calls));
  assert.deepEqual(first, { requested: 4, updated: 2, cursor: 9 });
  assert.equal(state(db, FEE_WALK_CURSOR_KEY), "9");
  assert.equal(state(db, FEE_TIP_WATERMARK_KEY), "12");

  const second = await reconcileStagedBitcoinFees(env, 4, provider(calls));
  assert.deepEqual(second, { requested: 4, updated: 2, cursor: 5 });
  assert.deepEqual(
    calls.map((hash) => Number.parseInt(hash, 16)),
    [12, 11, 10, 9, 8, 7, 6, 5],
  );

  const third = await reconcileStagedBitcoinFees(env, 4, provider(calls));
  assert.deepEqual(third, { requested: 4, updated: 2, cursor: 1 });
  const fourth = await reconcileStagedBitcoinFees(env, 4, provider(calls));
  assert.deepEqual(fourth, { requested: 0, updated: 0, cursor: null });
  assert.equal(state(db, FEE_WALK_CURSOR_KEY), null);
  assert.equal(missing(db), 6);
  assert.equal(state(db, "bitcoin_fees_remaining"), "6");

  // A completed cycle restarts at the top; the unresolvable rows cost one request per cycle.
  calls.length = 0;
  const fifth = await reconcileStagedBitcoinFees(env, 4, provider(calls));
  assert.deepEqual(fifth, { requested: 4, updated: 0, cursor: 5 });
  assert.deepEqual(
    calls.map((hash) => Number.parseInt(hash, 16)),
    [11, 9, 7, 5],
  );
});

test("new transactions are fetched ahead of the historical walk", async () => {
  const db = seed(6);
  const env = { CORE_DB: d1(db), ELECTRS_API_BASE: "https://electrs.test" };
  const calls: string[] = [];
  await reconcileStagedBitcoinFees(env, 2, provider(calls));
  assert.equal(state(db, FEE_WALK_CURSOR_KEY), "5");

  db.prepare(`INSERT INTO transactions(tx_index,tx_hash,block_index,block_time,supported) VALUES(?,?,?,?,1)`).run(
    8,
    Buffer.from(hashOf(8), "hex"),
    8,
    4_800,
  );
  calls.length = 0;
  const result = await reconcileStagedBitcoinFees(env, 2, provider(calls));
  assert.deepEqual(result, { requested: 2, updated: 2, cursor: 4 });
  assert.deepEqual(
    calls.map((hash) => Number.parseInt(hash, 16)),
    [8, 4],
  );
  assert.equal(state(db, FEE_TIP_WATERMARK_KEY), "8");
  assert.equal((db.prepare(`SELECT fee FROM transactions WHERE tx_index=8`).get() as { fee: string }).fee, "80");
});
