import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Env } from "#api/env";
import { batchRecoveryStatements, importRecoveryTransactions, RECOVERY_OUTPUT_UPSERT_SQL } from "#api/recovery/import";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";
import { recoveryCandidates } from "#api/recovery/scanner";

test("recovery imports chunk large Counterparty transactions at the D1 batch ceiling", async () => {
  const batches: D1PreparedStatement[][] = [];
  const db = {
    batch: async (statements: D1PreparedStatement[]) => {
      batches.push(statements);
      return [];
    },
  };
  const statements = Array.from({ length: 172 }, (_, index) => ({ index }) as unknown as D1PreparedStatement);

  await batchRecoveryStatements(db, statements);

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 72],
  );
  assert.equal((batches[0]![0] as unknown as { index: number }).index, 0);
  assert.equal((batches[1]![0] as unknown as { index: number }).index, 100);
});

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const recoveryKey = hex(secp256k1.getPublicKey(new Uint8Array(32).fill(7), true));
const counterpartyPrefix = hex(new TextEncoder().encode("CNTRPRTY"));
const dataKey = `08${counterpartyPrefix}${"00".repeat(24)}`;
const multisig = `51${(recoveryKey.length / 2).toString(16)}${recoveryKey}21${dataKey}52ae`;
const input = `${"12".repeat(32)}0000000000ffffffff`;
const raw = `0100000001${input}01e803000000000000${(multisig.length / 2).toString(16)}${multisig}00000000`;

function importEnvironment(puts: string[], batches: number[]): Env {
  const statement = {
    bind() {
      return this;
    },
  } as unknown as D1PreparedStatement;
  return {
    RECOVERY_DB: {
      prepare: () => statement,
      batch: async (items: D1PreparedStatement[]) => {
        batches.push(items.length);
        return [];
      },
    } as unknown as D1Database,
    RECOVERY_TRANSACTIONS: {
      put: async (key: string) => {
        puts.push(key);
        return null;
      },
    } as unknown as R2Bucket,
  } as Env;
}

const importRow = () => ({
  txid: parseRecoveryTransaction(raw).txid,
  raw_transaction_hex: raw,
  outputs: recoveryCandidates(raw, 900_000, 1_700_000_000),
});

test("normal recovery imports persist their canonical raw transaction", async () => {
  const puts: string[] = [];
  const batches: number[] = [];

  assert.equal(await importRecoveryTransactions(importEnvironment(puts, batches), [importRow()]), 1);
  assert.equal(puts.length, 1);
  assert.deepEqual(batches, [1]);
});

test("reclassification can reuse its R2 body without rewriting the same object", async () => {
  const puts: string[] = [];
  const batches: number[] = [];

  assert.equal(
    await importRecoveryTransactions(importEnvironment(puts, batches), [importRow()], {
      persistRawTransactions: false,
    }),
    1,
  );
  assert.equal(puts.length, 0);
  assert.deepEqual(batches, [1]);
});

type OutputRow = { classification: string; spent_by_txid: string | null; chain_checked_at: number | null };

/** Re-import the same output the way the scanner does: creation facts only, no spend evidence. */
function rescan(db: DatabaseSync, spend: { txid: string; height: number } | null = null): OutputRow {
  db.prepare(RECOVERY_OUTPUT_UPSERT_SQL).run(
    "aa",
    0,
    1_000,
    "51ae",
    "current-1-of-3",
    null,
    2,
    "1Cw7uQakqTLnch4HdGAiGdcBk2ynKV8T3s",
    spend ? "spent" : "recoverable",
    spend ? "verified-output-already-spent" : "verified-counterparty-recovery-output",
    800_000,
    1_700_000_000,
    spend?.txid ?? null,
    spend?.height ?? null,
    1_800,
    1,
  );
  // node:sqlite hands back null-prototype rows; spread so deep-equal compares values, not prototypes.
  return {
    ...(db.prepare(`SELECT classification,spent_by_txid,chain_checked_at FROM recovery_outputs`).get() as OutputRow),
  };
}

function outputsDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE recovery_outputs(
      txid TEXT NOT NULL,vout INTEGER NOT NULL,value_sats INTEGER NOT NULL,script_pubkey_hex TEXT NOT NULL,
      layout TEXT NOT NULL,recovery_key_hex TEXT,recovery_key_position INTEGER,recovery_address TEXT,
      classification TEXT NOT NULL,reason TEXT NOT NULL,block_height INTEGER,block_time INTEGER,
      spent_by_txid TEXT,spent_height INTEGER,verified_at INTEGER NOT NULL,classifier_version INTEGER NOT NULL,
      chain_checked_at INTEGER,PRIMARY KEY(txid,vout)) WITHOUT ROWID;
  `);
  return db;
}

test("re-importing a settled output never resurrects it as recoverable", () => {
  const db = outputsDatabase();
  rescan(db);
  db.prepare(
    `UPDATE recovery_outputs SET classification='spent',spent_by_txid='c2',spent_height=960262,chain_checked_at=1700`,
  ).run();

  // The scanner replays this row on any cursor rewind, carrying no spend evidence of its own.
  assert.deepEqual(rescan(db), { classification: "spent", spent_by_txid: "c2", chain_checked_at: 1_700 });
});

test("re-importing never clears spend evidence from a previously unverified output", () => {
  const db = outputsDatabase();
  rescan(db);
  db.prepare(
    `UPDATE recovery_outputs SET classification='unverified',spent_by_txid='c2',spent_height=960262,chain_checked_at=1700`,
  ).run();

  assert.deepEqual(rescan(db), { classification: "unverified", spent_by_txid: "c2", chain_checked_at: 1_700 });
});

test("an importer that supplies its own spend evidence still wins", () => {
  const db = outputsDatabase();
  rescan(db);

  assert.deepEqual(rescan(db, { txid: "c2", height: 960_262 }), {
    classification: "spent",
    spent_by_txid: "c2",
    chain_checked_at: null,
  });
});

test("re-importing an unspent output re-queues it for verification", () => {
  const db = outputsDatabase();
  rescan(db);
  db.prepare(`UPDATE recovery_outputs SET chain_checked_at=1700`).run();

  assert.deepEqual(rescan(db), { classification: "recoverable", spent_by_txid: null, chain_checked_at: null });
});
