import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  classifyAttemptEvidence,
  reconcileRecoveryAttempts,
  recoveryAttemptStatements,
  settledSpendTxid,
  RECOVERY_ATTEMPT_QUEUE_SQL,
  RECOVERY_MARK_SPENT_SQL,
  RECOVERY_SPEND_CONFIRMATIONS,
  type AttemptEvidence,
  type AttemptProviders,
} from "#api/recovery/attempts";

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

function recordingDb() {
  const prepared: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        sql,
        bind(...values: unknown[]) {
          prepared.push({ sql, values });
          return statement;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, prepared };
}

function evidenceFor(status: AttemptEvidence["status"], overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  return {
    status,
    replacementTxid: null,
    blockHeight: null,
    blockHash: null,
    blockTime: null,
    confirmations: 0,
    reason: status,
    ...overrides,
  };
}

test("a deeply confirmed recovery settles each consumed output by primary key", () => {
  const { db, prepared } = recordingDb();
  const inputs = [
    { input_txid: "aa".repeat(32), input_vout: 0 },
    { input_txid: "bb".repeat(32), input_vout: 2 },
  ];
  const statements = recoveryAttemptStatements(
    db,
    txid,
    evidenceFor("confirmed", { blockHeight: 960_262, confirmations: RECOVERY_SPEND_CONFIRMATIONS }),
    1_700,
    inputs,
  );

  // Point updates, not a set-based scan: the planner walked the whole recoverable slice of the
  // table for the subquery form, and one large attempt at settlement depth took the database down.
  assert.equal(statements.length, 3, "the attempt row plus one spend update per consumed input");
  const spends = prepared.filter((row) => row.sql.includes("UPDATE recovery_outputs"));
  assert.deepEqual(
    spends.map((row) => row.values),
    inputs.map((input) => ["spent-by-confirmed-recovery", txid, 960_262, 1_700, input.input_txid, input.input_vout]),
  );
  for (const spend of spends) {
    assert.equal(
      spend.sql.includes("classification='recoverable'"),
      true,
      "a richer classification must never be overwritten",
    );
    assert.equal(spend.sql.includes("txid=? AND vout=?"), true, "each update is a primary-key point write");
  }
});

test("a spend is not settled durably until it is deep enough to survive a reorg", () => {
  const { db, prepared } = recordingDb();
  const shallow = evidenceFor("confirmed", { blockHeight: 960_262, confirmations: RECOVERY_SPEND_CONFIRMATIONS - 1 });

  assert.equal(
    recoveryAttemptStatements(db, txid, shallow, 1_700, [{ input_txid: "aa".repeat(32), input_vout: 0 }]).length,
    1,
  );
  assert.equal(
    prepared.some((row) => row.sql.includes("UPDATE recovery_outputs")),
    false,
    "the read path already withholds these inputs, so waiting costs the owner nothing",
  );
});

test("no other attempt outcome writes a spend of its own", () => {
  const replacement = "99".repeat(32);
  const outcomes: AttemptEvidence[] = [
    evidenceFor("pending"),
    evidenceFor("failed"),
    // A replacement's own depth is unknown, so the verification sweep settles it from the chain.
    evidenceFor("replaced", { replacementTxid: replacement, confirmations: 100 }),
  ];
  for (const evidence of outcomes) {
    const { db, prepared } = recordingDb();
    const statements = recoveryAttemptStatements(db, txid, evidence, 1_700, [
      { input_txid: "aa".repeat(32), input_vout: 0 },
    ]);
    assert.equal(statements.length, 1, `${evidence.status} must not settle a spend`);
    assert.equal(
      prepared.some((row) => row.sql.includes("UPDATE recovery_outputs")),
      false,
    );
  }
});

test("marking spent settles exactly the attempt's own unspent inputs", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,classification TEXT NOT NULL,
      reason TEXT,spent_by_txid TEXT,spent_height INTEGER,chain_checked_at INTEGER,PRIMARY KEY(txid,vout)) WITHOUT ROWID;
    CREATE TABLE recovery_attempt_inputs(recovery_txid TEXT NOT NULL,input_txid TEXT NOT NULL,input_vout INTEGER NOT NULL,
      PRIMARY KEY(recovery_txid,input_txid,input_vout)) WITHOUT ROWID;
    INSERT INTO recovery_outputs VALUES
      ('aa',0,'recoverable',NULL,NULL,NULL,NULL),
      ('aa',1,'recoverable',NULL,NULL,NULL,NULL),
      ('bb',0,'recoverable',NULL,NULL,NULL,NULL),
      ('cc',0,'spent','earlier','ff',900000,10);
    INSERT INTO recovery_attempt_inputs VALUES ('r1','aa',0),('r1','cc',0),('r2','bb',0);
  `);

  // The reconcile pass drives from the attempt's own input list, one point write per outpoint.
  const r1Inputs = db
    .prepare(`SELECT input_txid,input_vout FROM recovery_attempt_inputs WHERE recovery_txid='r1'`)
    .all() as { input_txid: string; input_vout: number }[];
  let changes = 0;
  for (const input of r1Inputs) {
    changes += Number(
      db
        .prepare(RECOVERY_MARK_SPENT_SQL)
        .run("spent-by-confirmed-recovery", "r1", 960_262, 1_700, input.input_txid, input.input_vout).changes,
    );
  }

  assert.equal(changes, 1, "only the attempt's still-recoverable input is settled");
  const rows = db
    .prepare(`SELECT txid,vout,classification,spent_by_txid FROM recovery_outputs ORDER BY txid,vout`)
    .all();
  assert.deepEqual(
    rows.map((row) => `${row.txid}:${row.vout}=${row.classification}`),
    ["aa:0=spent", "aa:1=recoverable", "bb:0=recoverable", "cc:0=spent"],
  );
  assert.equal(rows[3]!.spent_by_txid, "ff", "an existing spend keeps its original attribution");

  let replayChanges = 0;
  for (const input of r1Inputs) {
    replayChanges += Number(
      db
        .prepare(RECOVERY_MARK_SPENT_SQL)
        .run("spent-by-confirmed-recovery", "r1", 960_262, 1_800, input.input_txid, input.input_vout).changes,
    );
  }
  assert.equal(replayChanges, 0, "every later reconcile pass is a no-op");
});

test("only a deeply confirmed attempt names a settled spending transaction", () => {
  const deep = { confirmations: RECOVERY_SPEND_CONFIRMATIONS };
  assert.equal(settledSpendTxid(txid, evidenceFor("confirmed", deep)), txid);
  assert.equal(settledSpendTxid(txid, evidenceFor("confirmed", { confirmations: 1 })), null);
  assert.equal(settledSpendTxid(txid, evidenceFor("replaced", { replacementTxid: "99".repeat(32), ...deep })), null);
  assert.equal(settledSpendTxid(txid, evidenceFor("pending", deep)), null);
  assert.equal(settledSpendTxid(txid, evidenceFor("failed", deep)), null);
});

test("reconciliation stops re-reading an attempt only once its spends are settled", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_attempts(txid TEXT PRIMARY KEY,status TEXT NOT NULL,confirmations INTEGER NOT NULL,
      chain_checked_at INTEGER,reported_at INTEGER NOT NULL) WITHOUT ROWID;
    CREATE TABLE recovery_attempt_inputs(recovery_txid TEXT NOT NULL,input_txid TEXT NOT NULL,input_vout INTEGER NOT NULL,
      PRIMARY KEY(recovery_txid,input_txid,input_vout)) WITHOUT ROWID;
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,classification TEXT NOT NULL,
      PRIMARY KEY(txid,vout)) WITHOUT ROWID;
    INSERT INTO recovery_attempts VALUES
      ('settled','confirmed',400,1,1),
      ('shallow','confirmed',2,2,2),
      ('stale','confirmed',400,3,3),
      ('waiting','pending',0,4,4);
    INSERT INTO recovery_attempt_inputs VALUES
      ('settled','a',0),('shallow','b',0),('stale','c',0),('waiting','d',0);
    INSERT INTO recovery_outputs VALUES ('a',0,'spent'),('b',0,'recoverable'),('c',0,'recoverable'),('d',0,'recoverable');
  `);

  const queued = (
    db.prepare(RECOVERY_ATTEMPT_QUEUE_SQL).all(RECOVERY_SPEND_CONFIRMATIONS, 10) as { txid: string }[]
  ).map((row) => row.txid);

  assert.equal(queued.includes("settled"), false, "a deep confirmation with no recoverable inputs left is done");
  assert.deepEqual(queued, ["shallow", "stale", "waiting"]);
  assert.equal(
    queued.includes("stale"),
    true,
    "an attempt confirmed before spend settlement existed still heals itself",
  );
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
      if (this.sql.includes("FROM recovery_attempts a"))
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
  let outspendCalls = 0;
  const providers: AttemptProviders = {
    tipHeight: async () => 900_005,
    transactionStatus: async (_baseUrl, candidate) => {
      if (candidate === broken) throw new Error("provider failure");
      return { confirmed: false, blockHeight: null, blockHash: null, blockTime: null };
    },
    transactionOutspends: async () => {
      outspendCalls++;
      return [unspent];
    },
  };
  const result = await reconcileRecoveryAttempts(
    { RECOVERY_DB: db, ELECTRS_API_BASE: "https://electrs.example" } as never,
    2,
    providers,
  );
  assert.deepEqual(result, { checked: 1, failed: 1 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.at(-1), healthy);
  assert.equal(outspendCalls, 0);
});
