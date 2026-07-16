import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAttemptEvidence, reconcileRecoveryAttempts, type AttemptProviders } from "#api/recovery/attempts";

const txid = "11".repeat(32);
const unspent = { spent: false, txid: null, block_height: null };

test("a confirmed recovery reports confirmations from the current tip", () => {
  assert.deepEqual(
    classifyAttemptEvidence(
      txid,
      { confirmed: true, blockHeight: 900_000, blockHash: "22".repeat(32), blockTime: 1_700_000_000 },
      [unspent],
      900_005,
    ),
    {
      status: "confirmed",
      replacementTxid: null,
      blockHeight: 900_000,
      blockHash: "22".repeat(32),
      blockTime: 1_700_000_000,
      confirmations: 6,
      reason: "transaction-confirmed",
    },
  );
});

test("an observed mempool recovery stays pending", () => {
  assert.equal(
    classifyAttemptEvidence(
      txid,
      { confirmed: false, blockHeight: null, blockHash: null, blockTime: null },
      [unspent],
      900_005,
    ).reason,
    "transaction-in-mempool",
  );
});

test("absence alone never fails a recovery", () => {
  assert.deepEqual(classifyAttemptEvidence(txid, null, [unspent], 900_005), {
    status: "pending",
    replacementTxid: null,
    blockHeight: null,
    blockHash: null,
    blockTime: null,
    confirmations: 0,
    reason: "transaction-not-seen-inputs-unspent",
  });
});

test("a single conflicting spender is deterministic replacement evidence", () => {
  const replacement = "33".repeat(32);
  const result = classifyAttemptEvidence(
    txid,
    null,
    [unspent, { spent: true, txid: replacement, block_height: null }],
    900_005,
  );
  assert.equal(result.status, "replaced");
  assert.equal(result.replacementTxid, replacement);
});

test("multiple conflicting spenders deterministically make the original impossible without inventing a replacement", () => {
  const result = classifyAttemptEvidence(
    txid,
    null,
    [
      { spent: true, txid: "33".repeat(32), block_height: 900_001 },
      { spent: true, txid: "44".repeat(32), block_height: 900_002 },
    ],
    900_005,
  );
  assert.equal(result.status, "failed");
  assert.equal(result.replacementTxid, null);
  assert.equal(result.reason, "inputs-spent-by-multiple-transactions");
});

test("one provider failure does not block healthy recovery attempts", async () => {
  const healthy = "55".repeat(32);
  const broken = "66".repeat(32);
  const parent = "77".repeat(32);
  const updates: unknown[][] = [];
  class Statement {
    values: unknown[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    }
    async all<T>() {
      if (this.sql.includes("SELECT txid FROM recovery_attempts"))
        return { results: [{ txid: healthy }, { txid: broken }] as T[] };
      return {
        results: [
          { recovery_txid: healthy, input_txid: parent, input_vout: 0 },
          { recovery_txid: broken, input_txid: parent, input_vout: 0 },
        ] as T[],
      };
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      updates.push(...statements.map((statement) => statement.values));
      return [];
    },
  } as unknown as D1Database;
  const providers: AttemptProviders = {
    tipHeight: async () => 900_005,
    transactionStatus: async (_baseUrl, candidate) => {
      if (candidate === broken) throw new Error("provider failure");
      return { confirmed: false, blockHeight: null, blockHash: null, blockTime: null };
    },
    transactionOutspends: async () => [unspent],
  };
  const result = await reconcileRecoveryAttempts(
    { RECOVERY_DB: db, ELECTRS_API_BASE: "https://electrs.example" } as never,
    2,
    providers,
  );
  assert.deepEqual(result, { checked: 1, failed: 1 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.at(-1), healthy);
});
