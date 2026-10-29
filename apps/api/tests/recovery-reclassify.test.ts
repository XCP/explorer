import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_CLASSIFIER_VERSION } from "#api/recovery/classifier";
import {
  RECOVERY_RECLASSIFY_PRIORITY_QUEUE_SQL,
  RECOVERY_RECLASSIFY_QUEUE_SQL,
  retainRecoverySpendEvidence,
} from "#api/recovery/reclassify";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,block_height INTEGER,block_time INTEGER,
      classifier_version INTEGER NOT NULL,layout TEXT,classification TEXT,PRIMARY KEY(txid,vout)) WITHOUT ROWID;
    CREATE INDEX recovery_outputs_classifier ON recovery_outputs(classifier_version,txid);
  `);
  return db;
}

function queued(db: DatabaseSync, limit = 10) {
  return (
    db.prepare(RECOVERY_RECLASSIFY_QUEUE_SQL).all(RECOVERY_CLASSIFIER_VERSION, limit) as {
      txid: string;
      block_height: number | null;
      block_time: number | null;
    }[]
  ).map((row) => ({ ...row }));
}

test("only transactions decided by an older classifier are queued", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,?,800000,1700000000,?,NULL,NULL)`);
  add.run("aa", 0, RECOVERY_CLASSIFIER_VERSION - 1);
  add.run("bb", 0, RECOVERY_CLASSIFIER_VERSION);

  assert.deepEqual(queued(db), [{ txid: "aa", block_height: 800_000, block_time: 1_700_000_000 }]);
});

test("a transaction is queued once and carries the chain metadata its outputs recorded", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,?,?,?,?,NULL,NULL)`);
  add.run("aa", 0, 800_000, 1_700_000_000, RECOVERY_CLASSIFIER_VERSION - 1);
  add.run("aa", 1, 800_000, 1_700_000_000, RECOVERY_CLASSIFIER_VERSION - 1);

  assert.deepEqual(queued(db), [{ txid: "aa", block_height: 800_000, block_time: 1_700_000_000 }]);
});

test("the sweep walks the backlog deterministically so it can resume", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,1,1,?,NULL,NULL)`);
  for (const txid of ["cc", "aa", "bb"]) add.run(txid, RECOVERY_CLASSIFIER_VERSION - 1);

  assert.deepEqual(
    queued(db, 2).map((row) => row.txid),
    ["aa", "bb"],
  );
});

test("an index already on the current classifier has nothing to do", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_outputs VALUES ('aa',0,1,1,?,NULL,NULL)`).run(RECOVERY_CLASSIFIER_VERSION);

  assert.deepEqual(queued(db), []);
});

test("the priority queue contains only unverified historical continuations after a proven anchor", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,?,?,?,?,?,?)`);
  const old = RECOVERY_CLASSIFIER_VERSION - 1;
  add.run("eligible", 0, 300_000, 1_400_000_000, old, "historical-1-of-2", "recoverable");
  add.run("eligible", 1, 300_000, 1_400_000_000, old, "historical-1-of-2", "unverified");
  add.run("gap", 0, 300_001, 1_400_000_001, old, "historical-1-of-2", "recoverable");
  add.run("gap", 2, 300_001, 1_400_000_001, old, "historical-1-of-2", "unverified");
  add.run("current", 0, 800_000, 1_700_000_000, old, "current-1-of-3", "recoverable");
  add.run("current", 1, 800_000, 1_700_000_000, old, "current-1-of-3", "unverified");

  assert.deepEqual(
    db
      .prepare(RECOVERY_RECLASSIFY_PRIORITY_QUEUE_SQL)
      .all(RECOVERY_CLASSIFIER_VERSION, 10)
      .map((row) => ({ ...row })),
    [{ txid: "eligible", block_height: 300_000, block_time: 1_400_000_000 }],
  );
});

test("reclassification carries settled spend evidence into the new verdict", () => {
  assert.deepEqual(
    retainRecoverySpendEvidence(
      [
        { vout: 0, value_sats: 1_000, script_pubkey_hex: "51" },
        { vout: 1, value_sats: 2_000, script_pubkey_hex: "51" },
      ],
      [{ vout: 1, spent_by_txid: "cc", spent_height: 900_000 }],
    ),
    [
      { vout: 0, value_sats: 1_000, script_pubkey_hex: "51" },
      {
        vout: 1,
        value_sats: 2_000,
        script_pubkey_hex: "51",
        spent_by_txid: "cc",
        spent_height: 900_000,
      },
    ],
  );
});
