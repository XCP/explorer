import { test } from "node:test";
import assert from "node:assert/strict";
import { coreTransactionReadinessFailures } from "#api/indexer/core-readiness";

test("core transaction readiness accepts a completed matching store", () => {
  assert.deepEqual(
    coreTransactionReadinessFailures({
      sourceRows: 100,
      coreRows: 100,
      sourceFirst: 0,
      sourceLast: 99,
      coreFirst: 0,
      coreLast: 99,
      done: true,
      sampleMatches: [true, true, true],
    }),
    [],
  );
});

test("core transaction readiness names incomplete, count, extrema, and sample failures", () => {
  const failures = coreTransactionReadinessFailures({
    sourceRows: 100,
    coreRows: 50,
    sourceFirst: 0,
    sourceLast: 99,
    coreFirst: 0,
    coreLast: 49,
    done: false,
    sampleMatches: [true, false],
  });
  assert.equal(failures.includes("transaction backfill is incomplete"), true);
  assert.equal(failures.includes("transaction row counts differ"), true);
  assert.equal(failures.includes("transaction index extrema differ"), true);
  assert.equal(failures.includes("one or more decoded transaction samples differ"), true);
});

test("two empty transaction stores can never be ready", () => {
  const failures = coreTransactionReadinessFailures({
    sourceRows: 0,
    coreRows: 0,
    sourceFirst: null,
    sourceLast: null,
    coreFirst: null,
    coreLast: null,
    done: true,
    sampleMatches: [],
  });
  assert.equal(failures.length > 0, true);
});
