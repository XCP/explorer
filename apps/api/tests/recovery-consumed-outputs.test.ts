import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CONSUMED_BY_ATTEMPT_FILTER } from "#api/recovery/read";

const address = "1Cw7uQakqTLnch4HdGAiGdcBk2ynKV8T3s";
const txid = (value: number) => value.toString(16).padStart(64, "0");

/** The address page's recoverable predicate, exactly as the route composes it without stamp protection. */
const RECOVERABLE_SQL = `
  SELECT txid,vout FROM recovery_outputs
   WHERE recovery_address=? AND classification='recoverable'
     ${CONSUMED_BY_ATTEMPT_FILTER}
   ORDER BY txid,vout`;

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_outputs(
      txid TEXT NOT NULL,vout INTEGER NOT NULL,recovery_address TEXT,classification TEXT NOT NULL,
      PRIMARY KEY(txid,vout)) WITHOUT ROWID;
    CREATE TABLE recovery_attempts(
      txid TEXT PRIMARY KEY,address TEXT NOT NULL,status TEXT NOT NULL,
      inputs_released INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
    CREATE TABLE recovery_attempt_inputs(
      recovery_txid TEXT NOT NULL,input_txid TEXT NOT NULL,input_vout INTEGER NOT NULL,
      PRIMARY KEY(recovery_txid,input_txid,input_vout)) WITHOUT ROWID;
    CREATE INDEX recovery_attempt_inputs_output ON recovery_attempt_inputs(input_txid,input_vout);
  `);
  return db;
}

function recoverable(db: DatabaseSync): string[] {
  return (db.prepare(RECOVERABLE_SQL).all(address) as { txid: string; vout: number }[]).map(
    (row) => `${row.txid}:${row.vout}`,
  );
}

/**
 * The bug this guards: a recovery that confirmed on-chain had its inputs handed straight back to the
 * owner, whose next attempt then failed to broadcast with bad-txns-inputs-missingorspent.
 */
test("an output consumed by a recovery attempt is never offered again, whatever the attempt's status", () => {
  for (const status of ["pending", "confirmed", "replaced", "failed"] as const) {
    const db = database();
    const recovery = txid(9);
    db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable')`).run(txid(1), address);
    db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable')`).run(txid(2), address);
    db.prepare(`INSERT INTO recovery_attempts VALUES (?,?,?,0)`).run(recovery, address, status);
    db.prepare(`INSERT INTO recovery_attempt_inputs VALUES (?,?,0)`).run(recovery, txid(1));

    assert.deepEqual(recoverable(db), [`${txid(2)}:0`], `a ${status} attempt must still withhold its inputs`);
  }
});

test("outputs the owner never reported stay recoverable", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable')`).run(txid(1), address);
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,1,?,'recoverable')`).run(txid(1), address);

  assert.deepEqual(recoverable(db), [`${txid(1)}:0`, `${txid(1)}:1`]);
});

test("the filter matches an exact output, not merely its transaction", () => {
  const db = database();
  const recovery = txid(9);
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable')`).run(txid(1), address);
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,1,?,'recoverable')`).run(txid(1), address);
  db.prepare(`INSERT INTO recovery_attempts VALUES (?,?,'confirmed',0)`).run(recovery, address);
  db.prepare(`INSERT INTO recovery_attempt_inputs VALUES (?,?,0)`).run(recovery, txid(1));

  assert.deepEqual(recoverable(db), [`${txid(1)}:1`], "sibling outputs of the same transaction remain available");
});

/**
 * The bug this guards: a recovery reported but never broadcast withheld its inputs forever, because
 * "the network has not seen it" is not a terminal status and the filter asked only about membership.
 * Four July 2026 attempts hid 196 outputs from their owners that way, with no spend to justify it.
 */
test("an abandoned attempt hands its inputs back, because nothing ever consumed them", () => {
  const db = database();
  const recovery = txid(9);
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable')`).run(txid(1), address);
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable')`).run(txid(2), address);
  db.prepare(`INSERT INTO recovery_attempts VALUES (?,?,'failed',1)`).run(recovery, address);
  db.prepare(`INSERT INTO recovery_attempt_inputs VALUES (?,?,0)`).run(recovery, txid(1));

  assert.deepEqual(recoverable(db), [`${txid(1)}:0`, `${txid(2)}:0`]);
});

test("one attempt releasing an output does not release another attempt's hold on it", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable')`).run(txid(1), address);
  db.prepare(`INSERT INTO recovery_attempts VALUES (?,?,'failed',1)`).run(txid(9), address);
  db.prepare(`INSERT INTO recovery_attempts VALUES (?,?,'confirmed',0)`).run(txid(8), address);
  db.prepare(`INSERT INTO recovery_attempt_inputs VALUES (?,?,0)`).run(txid(9), txid(1));
  db.prepare(`INSERT INTO recovery_attempt_inputs VALUES (?,?,0)`).run(txid(8), txid(1));

  assert.deepEqual(recoverable(db), [], "the confirmed spend still consumed it");
});

test("an output already classified spent is excluded regardless of attempt records", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'spent')`).run(txid(1), address);

  assert.deepEqual(recoverable(db), []);
});
