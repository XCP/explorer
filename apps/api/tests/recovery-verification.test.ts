import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "#api/env";
import { verificationRetryDelay, verifyRecoveryTransactions } from "#api/recovery/verify";

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
    if (this.sql.includes("GROUP BY o.txid")) {
      const limit = Number(this.values[1]);
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
