import { test } from "node:test";
import assert from "node:assert/strict";
import { activateLedgerReadCutover, rollbackLedgerReadCutover } from "#api/indexer/ledger-cutover";
import type { LedgerReadinessReport } from "#api/indexer/ledger-readiness";

function report(readCutover: string | null, failures: string[] = []): LedgerReadinessReport {
  return {
    ready: failures.length === 0,
    read_only: true,
    state: {
      backfill_active: "0",
      ledger_credit_done: "1",
      ledger_debit_done: "1",
      read_cutover: readCutover,
    },
    totals: {
      source: 100,
      compact: 100,
      match: true,
      first_event: { source: 1, compact: 1, match: true },
      last_event: { source: 100, compact: 100, match: true },
    },
    samples: [],
    failures,
  };
}

function database(changes: number, statements: string[]): D1Database {
  return {
    prepare(sql: string) {
      statements.push(sql);
      return {
        run: async () => ({ meta: { changes } }),
      };
    },
  } as unknown as D1Database;
}

test("activation fails closed without writing when readiness has any failure", async () => {
  const statements: string[] = [];
  const readiness = report("0", ["source and compact row counts differ"]);
  const env = { DB: database(0, []), LEDGER_DB: database(1, statements) };
  const result = await activateLedgerReadCutover(env, 2_000, async () => readiness);

  assert.equal(result.outcome, "blocked");
  assert.deepEqual(statements, []);
});

test("activation writes only read_cutover=1 after readiness passes", async () => {
  const statements: string[] = [];
  const env = { DB: database(0, []), LEDGER_DB: database(1, statements) };
  const result = await activateLedgerReadCutover(env, 2_000, async () => report("0"));

  assert.equal(result.outcome, "activated");
  assert.deepEqual(statements, ["UPDATE ledger_state SET value='1' WHERE key='read_cutover' AND value='0'"]);
});

test("activation is idempotent and still audits an active cutover", async () => {
  const statements: string[] = [];
  let audits = 0;
  const env = { DB: database(0, []), LEDGER_DB: database(1, statements) };
  const result = await activateLedgerReadCutover(env, undefined, async () => {
    audits += 1;
    return report("1");
  });

  assert.equal(result.outcome, "already_active");
  assert.equal(audits, 1);
  assert.deepEqual(statements, []);
});

test("activation reports a concurrent state change as blocked", async () => {
  const env = { DB: database(0, []), LEDGER_DB: database(0, []) };
  const result = await activateLedgerReadCutover(env, undefined, async () => report("0"));

  assert.equal(result.outcome, "blocked");
  assert.equal(result.readiness.ready, false);
  assert.match(result.readiness.failures.at(-1) ?? "", /changed during activation/);
});

test("rollback is a separate idempotent write that can only disable cutover", async () => {
  const changedStatements: string[] = [];
  const unchangedStatements: string[] = [];

  assert.equal((await rollbackLedgerReadCutover(database(1, changedStatements))).outcome, "rolled_back");
  assert.equal((await rollbackLedgerReadCutover(database(0, unchangedStatements))).outcome, "already_inactive");
  assert.deepEqual(changedStatements, ["UPDATE ledger_state SET value='0' WHERE key='read_cutover' AND value='1'"]);
  assert.deepEqual(unchangedStatements, changedStatements);
});
