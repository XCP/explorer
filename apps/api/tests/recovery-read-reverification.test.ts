import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  RECOVERY_READ_REVERIFY_SECONDS,
  RECOVERY_REQUEST_REVERIFY_SQL,
  RECOVERY_REVERIFY_INTERVAL_SECONDS,
  RECOVERY_VERIFICATION_QUEUE_SQL,
  VERIFICATION_BACKSTOP_WINDOW,
  verificationRetryQuota,
} from "#api/recovery/verify";

const address = "1Cw7uQakqTLnch4HdGAiGdcBk2ynKV8T3s";
const NOW = 10 * RECOVERY_REVERIFY_INTERVAL_SECONDS;
const txid = (value: number) => value.toString(16).padStart(64, "0");

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_outputs(txid TEXT NOT NULL,vout INTEGER NOT NULL,recovery_address TEXT,
      classification TEXT NOT NULL,value_sats INTEGER NOT NULL,chain_checked_at INTEGER,
      PRIMARY KEY(txid,vout)) WITHOUT ROWID;
    CREATE TABLE recovery_verification_failures(
      txid TEXT PRIMARY KEY,attempts INTEGER NOT NULL,first_failed_at INTEGER NOT NULL,last_failed_at INTEGER NOT NULL,
      next_retry_at INTEGER NOT NULL,last_error TEXT NOT NULL) WITHOUT ROWID;
  `);
  return db;
}

function request(db: DatabaseSync, limit = 420): number {
  return db.prepare(RECOVERY_REQUEST_REVERIFY_SQL).run(address, NOW - RECOVERY_READ_REVERIFY_SECONDS, limit).changes;
}

function checkedAt(db: DatabaseSync): (number | null)[] {
  return (
    db.prepare(`SELECT chain_checked_at FROM recovery_outputs ORDER BY txid`).all() as {
      chain_checked_at: number | null;
    }[]
  ).map((row) => row.chain_checked_at);
}

test("a page view asks for its own outputs to be re-checked", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable',1000,?)`);
  add.run(txid(1), address, NOW - RECOVERY_READ_REVERIFY_SECONDS - 1);
  add.run(txid(2), "someone-else", NOW - RECOVERY_READ_REVERIFY_SECONDS - 1);

  assert.equal(request(db), 1, "only the address being read is requested");
  assert.deepEqual(checkedAt(db), [0, NOW - RECOVERY_READ_REVERIFY_SECONDS - 1]);
});

test("refreshing the page repeatedly writes nothing", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable',1000,?)`).run(
    txid(1),
    address,
    NOW - RECOVERY_READ_REVERIFY_SECONDS - 1,
  );

  assert.equal(request(db), 1);
  assert.equal(request(db), 0, "an outstanding request is not re-issued");
  assert.equal(request(db), 0);
});

test("a recently verified address is left alone", () => {
  const db = database();
  db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable',1000,?)`).run(txid(1), address, NOW - 60);

  assert.equal(request(db), 0, "a fresh verdict does not need re-checking");
});

test("requests are bounded to the page and take the highest value outputs first", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable',?,?)`);
  add.run(txid(1), address, 500, 1);
  add.run(txid(2), address, 9_000, 1);
  add.run(txid(3), address, 1_000, 1);

  assert.equal(request(db, 2), 2);
  assert.deepEqual(checkedAt(db), [1, 0, 0], "the two largest outputs are the ones re-checked");
});

test("a requested output outranks the rolling backstop but never a new import", () => {
  const db = database();
  const add = db.prepare(`INSERT INTO recovery_outputs VALUES (?,0,?,'recoverable',1000,?)`);
  add.run(txid(1), address, NOW - RECOVERY_REVERIFY_INTERVAL_SECONDS - 1); // stale backstop work
  add.run(txid(2), address, 0); // reader request
  add.run(txid(3), address, null); // never imported before

  const staleBefore = NOW - RECOVERY_REVERIFY_INTERVAL_SECONDS;
  const queued = (
    db
      .prepare(RECOVERY_VERIFICATION_QUEUE_SQL)
      .all(
        NOW,
        staleBefore,
        verificationRetryQuota(10),
        10,
        staleBefore,
        10 * VERIFICATION_BACKSTOP_WINDOW,
        10,
        10,
      ) as {
      txid: string;
    }[]
  ).map((row) => row.txid);

  assert.deepEqual(queued, [txid(3), txid(2), txid(1)]);
});
