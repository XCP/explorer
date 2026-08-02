import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_CLASSIFIER_VERSION } from "#api/recovery/classifier";
import { RECOVERY_RECLASSIFY_QUEUE_SQL } from "#api/recovery/reclassify";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,block_height INTEGER,block_time INTEGER,
      classifier_version INTEGER NOT NULL,PRIMARY KEY(txid,vout)) WITHOUT ROWID;
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
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,?,800000,1700000000,?)`);
  add.run("aa", 0, RECOVERY_CLASSIFIER_VERSION - 1);
  add.run("bb", 0, RECOVERY_CLASSIFIER_VERSION);

  assert.deepEqual(queued(db), [{ txid: "aa", block_height: 800_000, block_time: 1_700_000_000 }]);
});

test("a transaction is queued once and carries the chain metadata its outputs recorded", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,?,?,?,?)`);
  add.run("aa", 0, 800_000, 1_700_000_000, RECOVERY_CLASSIFIER_VERSION - 1);
  add.run("aa", 1, 800_000, 1_700_000_000, RECOVERY_CLASSIFIER_VERSION - 1);

  assert.deepEqual(queued(db), [{ txid: "aa", block_height: 800_000, block_time: 1_700_000_000 }]);
});

test("the sweep walks the backlog deterministically so it can resume", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,1,1,?)`);
  for (const txid of ["cc", "aa", "bb"]) add.run(txid, RECOVERY_CLASSIFIER_VERSION - 1);

  assert.deepEqual(
    queued(db, 2).map((row) => row.txid),
    ["aa", "bb"],
  );
});

test("an index already on the current classifier has nothing to do", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_outputs VALUES ('aa',0,1,1,?)`).run(RECOVERY_CLASSIFIER_VERSION);

  assert.deepEqual(queued(db), []);
});
