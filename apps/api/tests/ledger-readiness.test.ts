import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerReadinessFailures } from "#api/indexer/ledger-readiness";

const complete = {
  state: { backfill_active: "0", ledger_credit_done: "1", ledger_debit_done: "1", read_cutover: "0" },
  sourceRows: 100,
  compactRows: 100,
  sourceFirst: 1,
  compactFirst: 1,
  sourceLast: 200,
  compactLast: 200,
  sampleMatches: [true, true, true],
};

test("ledger readiness accepts completed matching stores without requiring cutover", () => {
  assert.deepEqual(ledgerReadinessFailures(complete), []);
});

test("ledger readiness names every blocking invariant", () => {
  assert.deepEqual(
    ledgerReadinessFailures({
      ...complete,
      state: { ...complete.state, backfill_active: "1", ledger_debit_done: "0" },
      compactRows: 99,
      compactFirst: 2,
      compactLast: 199,
      sampleMatches: [true, false, true],
    }),
    [
      "backfill is still active",
      "debit backfill is incomplete",
      "source and compact row counts differ",
      "first event indexes differ",
      "last event indexes differ",
      "one or more bounded range samples differ",
    ],
  );
});

test("ledger readiness never treats two empty stores as cutover-ready", () => {
  assert.deepEqual(
    ledgerReadinessFailures({
      ...complete,
      sourceRows: 0,
      compactRows: 0,
      sourceFirst: null,
      compactFirst: null,
      sourceLast: null,
      compactLast: null,
      sampleMatches: [],
    }),
    ["source ledger is empty or unreadable", "compact ledger is empty or unreadable"],
  );
});

test("ledger readiness requires an explicit valid cutover state", () => {
  assert.deepEqual(
    ledgerReadinessFailures({
      ...complete,
      state: { ...complete.state, read_cutover: null },
    }),
    ["read cutover state is missing or invalid"],
  );
});
