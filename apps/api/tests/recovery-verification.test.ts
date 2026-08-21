import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "#api/env";
import {
  RECOVERY_REVERIFY_INTERVAL_SECONDS,
  RECOVERY_VERIFICATION_QUEUE_SQL,
  VERIFICATION_BACKSTOP_WINDOW,
  verificationRetryDelay,
  verificationRetryQuota,
  verifyRecoveryTransactions,
} from "#api/recovery/verify";

type Output = { txid: string; vout: number; classification: string; chain_checked_at: number | null };

class Statement {
  values: unknown[] = [];
  constructor(
    readonly db: FakeDb,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  all<T>() {
    // Matched on the queue's CTE name rather than a fragment of its body: the
    // previous marker was "GROUP BY o.txid", which the backstop rewrite renamed
    // to c.txid, so this silently stopped matching and the queue returned
    // nothing -- the tests failed claiming verification did no work, when what
    // had actually broken was the mock. The limit is the outer LIMIT, the last
    // of the eight bindings; it used to be index 4, which is now staleBefore.
    if (this.sql.includes("due_retries")) {
      const limit = Number(this.values[this.values.length - 1]);
      return Promise.resolve({
        results: [...new Set(this.db.outputs.filter((o) => o.chain_checked_at == null).map((o) => o.txid))]
          .slice(0, limit)
          .map((txid) => ({ txid })) as T[],
      });
    }
    if (this.sql.includes("WHERE txid=?"))
      return Promise.resolve({ results: this.db.outputs.filter((o) => o.txid === this.values[0]) as T[] });
    return Promise.resolve({ results: [] as T[] });
  }
  run() {
    if (this.sql.startsWith("UPDATE recovery_outputs")) {
      const [, , , , checkedAt, txid, vout] = this.values;
      const output = this.db.outputs.find((row) => row.txid === txid && row.vout === vout);
      if (output) output.chain_checked_at = Number(checkedAt);
    }
    if (this.sql.startsWith("INSERT INTO recovery_verification_failures")) this.db.failures.add(String(this.values[0]));
    if (this.sql.startsWith("DELETE FROM recovery_verification_failures"))
      this.db.failures.delete(String(this.values[0]));
    return Promise.resolve({ success: true });
  }
}

class FakeDb {
  failures = new Set<string>();
  constructor(readonly outputs: Output[]) {}
  prepare(sql: string) {
    return new Statement(this, sql);
  }
  batch(statements: Statement[]) {
    return Promise.all(
      statements.map(async (statement) =>
        statement.sql.startsWith("SELECT") ? statement.all() : (await statement.run(), { results: [] }),
      ),
    );
  }
}

test("verification isolates one failed transaction while healthy transactions advance", async () => {
  const failedTxid = "a".repeat(64);
  const healthyTxid = "b".repeat(64);
  const db = new FakeDb([
    { txid: failedTxid, vout: 0, classification: "recoverable", chain_checked_at: null },
    { txid: healthyTxid, vout: 0, classification: "recoverable", chain_checked_at: null },
  ]);
  const result = await verifyRecoveryTransactions({ RECOVERY_DB: db } as unknown as Env, 100, {
    now: 1_000,
    fetchOutspends: async (_base, txid) => {
      if (txid === failedTxid) throw new Error("temporary upstream failure");
      return [{ spent: false, txid: null, block_height: null }];
    },
  });

  assert.deepEqual(result, { transactions: 1, outputs: 1, spent: 0, failed: 1 });
  assert.equal(db.outputs[0].chain_checked_at, null);
  assert.equal(db.outputs[1].chain_checked_at, 1_000);
  assert.deepEqual([...db.failures], [failedTxid]);
});

test("an incomplete Electrs output array fails only its transaction", async () => {
  const txid = "c".repeat(64);
  const db = new FakeDb([
    { txid, vout: 0, classification: "recoverable", chain_checked_at: null },
    { txid, vout: 1, classification: "recoverable", chain_checked_at: null },
  ]);
  const result = await verifyRecoveryTransactions({ RECOVERY_DB: db } as unknown as Env, 1, {
    now: 2_000,
    fetchOutspends: async () => [{ spent: false, txid: null, block_height: null }],
  });

  assert.equal(result.failed, 1);
  assert.equal(result.outputs, 0);
  assert(db.outputs.every((output) => output.chain_checked_at == null));
});

test("verification retry delay is exponential and bounded", () => {
  assert.equal(verificationRetryDelay(1), 30);
  assert.equal(verificationRetryDelay(2), 60);
  assert.equal(verificationRetryDelay(11), 21_600);
  assert.equal(verificationRetryDelay(100), 21_600);
});

const txid = (value: number) => value.toString(16).padStart(64, "0");

function queueDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,classification TEXT NOT NULL DEFAULT 'recoverable',
      chain_checked_at INTEGER,PRIMARY KEY(txid,vout));
    CREATE INDEX recovery_outputs_verification ON recovery_outputs(chain_checked_at,txid,vout);
    CREATE TABLE recovery_verification_failures(
      txid TEXT PRIMARY KEY,attempts INTEGER NOT NULL,first_failed_at INTEGER NOT NULL,last_failed_at INTEGER NOT NULL,
      next_retry_at INTEGER NOT NULL,last_error TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX recovery_verification_failures_retry ON recovery_verification_failures(next_retry_at,txid);
  `);
  return db;
}

function queueRows(db: DatabaseSync, now: number, limit: number): string[] {
  const staleBefore = now - RECOVERY_REVERIFY_INTERVAL_SECONDS;
  return (
    db.prepare(RECOVERY_VERIFICATION_QUEUE_SQL).all(
      // Order matches the CTEs, and must track verify.ts exactly:
      // due_retries(now, staleBefore, retryQuota), never(limit),
      // backstop(staleBefore, scanWindow, limit), outer(limit).
      now,
      staleBefore,
      verificationRetryQuota(limit),
      limit,
      staleBefore,
      limit * VERIFICATION_BACKSTOP_WINDOW,
      limit,
      limit,
    ) as { txid: string }[]
  ).map((row) => row.txid);
}

test("verification queue reserves bounded capacity for due retries without starving fresh work", () => {
  const db = queueDatabase();
  const addOutput = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,'recoverable',NULL)`);
  const addFailure = db.prepare(`INSERT INTO recovery_verification_failures VALUES (?,1,1,1,?, '429')`);
  for (let value = 1; value <= 30; value++) addOutput.run(txid(value));
  addFailure.run(txid(1), 50);
  addFailure.run(txid(2), 60);
  addFailure.run(txid(3), 200);

  const limit = 20;
  const rows = queueRows(db, 100, limit);
  assert.equal(verificationRetryQuota(limit), 2);
  assert.equal(rows.length, limit);
  assert.deepEqual(rows.slice(0, 2), [txid(1), txid(2)]);
  assert.equal(rows.includes(txid(3)), false, "a retry before its due time must remain excluded");
  assert.equal(
    rows.slice(2).every((row) => Number.parseInt(row, 16) >= 4),
    true,
  );
});

test("a recoverable output is re-verified once its verdict goes stale", () => {
  const db = queueDatabase();
  const now = 10 * RECOVERY_REVERIFY_INTERVAL_SECONDS;
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,?)`);
  add.run(txid(1), "recoverable", now - RECOVERY_REVERIFY_INTERVAL_SECONDS - 1);
  add.run(txid(2), "recoverable", now - 60);

  const rows = queueRows(db, now, 10);
  assert.deepEqual(rows, [txid(1)], "only the stale verdict is re-checked");
});

test("a spent output is never re-verified and never displaces fresh work", () => {
  const db = queueDatabase();
  const now = 10 * RECOVERY_REVERIFY_INTERVAL_SECONDS;
  const stale = now - RECOVERY_REVERIFY_INTERVAL_SECONDS - 1;
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,?)`);
  add.run(txid(1), "spent", stale);
  add.run(txid(2), "recoverable", stale);
  add.run(txid(9), "recoverable", null);

  const rows = queueRows(db, now, 10);
  assert.equal(rows.includes(txid(1)), false, "a settled spend needs no further chain reads");
  assert.deepEqual(rows, [txid(9), txid(2)], "never-checked transactions always precede re-checks");
});
