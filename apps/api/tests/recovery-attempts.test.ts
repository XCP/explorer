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
  RECOVERY_ABANDON_AFTER_SECONDS,
  RECOVERY_ABANDONED_REASON,
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
      0,
    ),
    {
      status: "confirmed",
      replacementTxid: null,
      blockHeight: 900_000,
      blockHash: "22".repeat(32),
      blockTime: 1_700_000_000,
      confirmations: 6,
      reason: "transaction-confirmed",
      releasesInputs: false,
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
      0,
    ).reason,
    "transaction-in-mempool",
  );
});

test("absence alone never fails a recovery", () => {
  assert.deepEqual(classifyAttemptEvidence(txid, null, [unspent], 900_005, 0), {
    status: "pending",
    replacementTxid: null,
    blockHeight: null,
    blockHash: null,
    blockTime: null,
    confirmations: 0,
    reason: "transaction-not-seen-inputs-unspent",
    releasesInputs: false,
  });
});

/**
 * The bug this guards: four attempts reported in July 2026 were never broadcast, and because
 * `transaction-not-seen-inputs-unspent` is not terminal they withheld 196 of their owners' outputs
 * from the address page indefinitely, with nothing on chain that had consumed them.
 */
test("a recovery the network never saw releases its inputs once the abandonment window expires", () => {
  const result = classifyAttemptEvidence(txid, null, [unspent], 900_005, RECOVERY_ABANDON_AFTER_SECONDS);

  assert.equal(result.status, "failed");
  assert.equal(result.reason, RECOVERY_ABANDONED_REASON);
  assert.equal(result.releasesInputs, true, "nothing consumed these inputs, so the owner gets them back");
  assert.equal(result.replacementTxid, null);
});

test("inputs are held for the whole abandonment window, so a slow broadcast is never raced", () => {
  const result = classifyAttemptEvidence(txid, null, [unspent], 900_005, RECOVERY_ABANDON_AFTER_SECONDS - 1);

  assert.equal(result.status, "pending");
  assert.equal(result.reason, "transaction-not-seen-inputs-unspent");
  assert.equal(result.releasesInputs, false);
});

test("age alone never abandons a recovery the network can still see", () => {
  const ancient = RECOVERY_ABANDON_AFTER_SECONDS * 10;
  const inMempool = classifyAttemptEvidence(
    txid,
    { confirmed: false, blockHeight: null, blockHash: null, blockTime: null },
    [unspent],
    900_005,
    ancient,
  );
  assert.equal(inMempool.status, "pending");
  assert.equal(inMempool.releasesInputs, false);

  const replacement = "33".repeat(32);
  const replaced = classifyAttemptEvidence(
    txid,
    null,
    [{ spent: true, txid: replacement, block_height: null }],
    900_005,
    ancient,
  );
  assert.equal(replaced.status, "replaced");
  assert.equal(replaced.releasesInputs, false, "a replacement did consume these inputs");
});

test("a single conflicting spender is deterministic replacement evidence", () => {
  const replacement = "33".repeat(32);
  const result = classifyAttemptEvidence(
    txid,
    null,
    [unspent, { spent: true, txid: replacement, block_height: null }],
    900_005,
    0,
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
    0,
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
    releasesInputs: false,
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
  const attempt = prepared.find((row) => row.sql.includes("UPDATE recovery_attempts"));
  assert.equal(attempt?.values[6], 0, "the atomic batch removes completed settlement work from the queue");
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
  assert.equal(
    prepared.find((row) => row.sql.includes("UPDATE recovery_attempts"))?.values[6],
    1,
    "a shallow attempt remains queued for settlement",
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

test("an abandoned recovery records the release and leaves the work queue", () => {
  const { db, prepared } = recordingDb();
  const statements = recoveryAttemptStatements(
    db,
    txid,
    evidenceFor("failed", { reason: RECOVERY_ABANDONED_REASON, releasesInputs: true }),
    1_700,
    [{ input_txid: "aa".repeat(32), input_vout: 0 }],
  );

  assert.equal(statements.length, 1, "an abandoned attempt settles no spend of its own");
  const attempt = prepared.find((row) => row.sql.includes("UPDATE recovery_attempts"));
  assert.equal(attempt?.values[6], 0, "there is nothing left to reconcile, so it stops being re-read");
  assert.equal(attempt?.values[7], 1, "the read path learns these inputs were never consumed");
});

test("every other outcome keeps its inputs withheld", () => {
  for (const evidence of [
    evidenceFor("pending"),
    evidenceFor("failed", { reason: "inputs-spent-by-multiple-transactions" }),
    evidenceFor("replaced", { replacementTxid: "99".repeat(32) }),
    evidenceFor("confirmed", { confirmations: RECOVERY_SPEND_CONFIRMATIONS }),
  ]) {
    const { db, prepared } = recordingDb();
    recoveryAttemptStatements(db, txid, evidence, 1_700, [{ input_txid: "aa".repeat(32), input_vout: 0 }]);
    const attempt = prepared.find((row) => row.sql.includes("UPDATE recovery_attempts"));
    assert.equal(attempt?.values[7], 0, `${evidence.reason} must not release inputs`);
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
      settlement_pending INTEGER NOT NULL,inputs_released INTEGER NOT NULL DEFAULT 0,
      chain_checked_at INTEGER,reported_at INTEGER NOT NULL) WITHOUT ROWID;
    CREATE INDEX recovery_attempts_work_queue ON recovery_attempts(chain_checked_at,reported_at,txid)
      WHERE settlement_pending=1;
    CREATE TABLE recovery_attempt_inputs(recovery_txid TEXT NOT NULL,input_txid TEXT NOT NULL,input_vout INTEGER NOT NULL,
      PRIMARY KEY(recovery_txid,input_txid,input_vout)) WITHOUT ROWID;
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,classification TEXT NOT NULL,
      PRIMARY KEY(txid,vout)) WITHOUT ROWID;
    INSERT INTO recovery_attempts VALUES
      ('settled','confirmed',400,0,0,1,1),
      ('shallow','confirmed',2,1,0,2,2),
      ('stale','confirmed',400,1,0,3,3),
      ('waiting','pending',0,1,0,4,4);
    INSERT INTO recovery_attempt_inputs VALUES
      ('settled','a',0),('shallow','b',0),('stale','c',0),('waiting','d',0);
    INSERT INTO recovery_outputs VALUES ('a',0,'spent'),('b',0,'recoverable'),('c',0,'recoverable'),('d',0,'recoverable');
  `);

  const queued = (db.prepare(RECOVERY_ATTEMPT_QUEUE_SQL).all(10) as { txid: string }[]).map((row) => row.txid);

  assert.equal(queued.includes("settled"), false, "a deep confirmation with no recoverable inputs left is done");
  assert.deepEqual(queued, ["shallow", "stale", "waiting"]);
  db.exec(`INSERT INTO recovery_attempts VALUES ('abandoned','failed',0,0,1,5,5)`);
  assert.equal(
    (db.prepare(RECOVERY_ATTEMPT_QUEUE_SQL).all(10) as { txid: string }[]).some((row) => row.txid === "abandoned"),
    false,
    "an abandoned attempt is terminal: re-reading it every two minutes would never learn anything",
  );
  assert.equal(
    queued.includes("stale"),
    true,
    "migration-marked settlement work remains queued until its point updates commit",
  );
});

test("attempt reconciliation seeks only the partial work queue", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_attempts(txid TEXT PRIMARY KEY,status TEXT NOT NULL,confirmations INTEGER NOT NULL,
      settlement_pending INTEGER NOT NULL,inputs_released INTEGER NOT NULL DEFAULT 0,
      chain_checked_at INTEGER,reported_at INTEGER NOT NULL) WITHOUT ROWID;
    CREATE INDEX recovery_attempts_work_queue ON recovery_attempts(chain_checked_at,reported_at,txid)
      WHERE settlement_pending=1;
  `);

  const details = (db.prepare(`EXPLAIN QUERY PLAN ${RECOVERY_ATTEMPT_QUEUE_SQL}`).all(25) as { detail: string }[]).map(
    (row) => row.detail,
  );
  assert.equal(
    details.some((detail) => detail.includes("recovery_attempts_work_queue")),
    true,
    details.join("\n"),
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
        return {
          results: [
            { txid: healthy, reported_at: 0 },
            { txid: broken, reported_at: 0 },
          ] as T[],
        };
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
