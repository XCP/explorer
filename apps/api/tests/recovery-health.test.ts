import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_SPEND_CONFIRMATIONS } from "#api/recovery/attempts";
import { RECOVERY_UNSETTLED_SQL } from "#api/recovery/health";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_attempts(txid TEXT PRIMARY KEY,status TEXT NOT NULL,confirmations INTEGER NOT NULL) WITHOUT ROWID;
    CREATE TABLE recovery_attempt_inputs(recovery_txid TEXT NOT NULL,input_txid TEXT NOT NULL,input_vout INTEGER NOT NULL,
      PRIMARY KEY(recovery_txid,input_txid,input_vout)) WITHOUT ROWID;
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,classification TEXT NOT NULL,
      value_sats INTEGER NOT NULL,PRIMARY KEY(txid,vout)) WITHOUT ROWID;
  `);
  return db;
}

function unsettled(db: DatabaseSync) {
  return { ...(db.prepare(RECOVERY_UNSETTLED_SQL).get(RECOVERY_SPEND_CONFIRMATIONS) as Record<string, number>) };
}

test("a settled index reports no stranded outputs", () => {
  const db = database();
  db.exec(`
    INSERT INTO recovery_attempts VALUES ('r1','confirmed',400);
    INSERT INTO recovery_attempt_inputs VALUES ('r1','a',0),('r1','a',1);
    INSERT INTO recovery_outputs VALUES ('a',0,'spent',1000),('a',1,'spent',1000);
  `);

  assert.deepEqual(unsettled(db), { attempts: 0, outputs: 0, sats: 0 });
});

/** The exact shape of the production failure: a confirmed recovery whose inputs were handed back out. */
test("outputs a confirmed recovery already spent are counted as stranded", () => {
  const db = database();
  db.exec(`
    INSERT INTO recovery_attempts VALUES ('r1','confirmed',395);
    INSERT INTO recovery_attempt_inputs VALUES ('r1','a',0),('r1','a',1);
    INSERT INTO recovery_outputs VALUES ('a',0,'recoverable',1000),('a',1,'recoverable',1500);
  `);

  assert.deepEqual(unsettled(db), { attempts: 1, outputs: 2, sats: 2500 });
});

test("attempts that cannot have settled yet are not counted as failures", () => {
  const db = database();
  db.exec(`
    INSERT INTO recovery_attempts VALUES
      ('shallow','confirmed',${RECOVERY_SPEND_CONFIRMATIONS - 1}),
      ('waiting','pending',0),
      ('gone','replaced',0);
    INSERT INTO recovery_attempt_inputs VALUES ('shallow','a',0),('waiting','b',0),('gone','c',0);
    INSERT INTO recovery_outputs VALUES ('a',0,'recoverable',1000),('b',0,'recoverable',1000),('c',0,'recoverable',1000);
  `);

  assert.deepEqual(
    unsettled(db),
    { attempts: 0, outputs: 0, sats: 0 },
    "only a spend that should already be durable counts against the invariant",
  );
});
