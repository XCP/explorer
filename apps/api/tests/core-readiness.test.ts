import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coreAssetReadinessFailures,
  coreBlockReadinessFailures,
  coreIssuanceReadinessFailures,
  coreTransactionReadinessFailures,
} from "#api/indexer/core-readiness";

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

test("core asset readiness accepts a completed matching store", () => {
  assert.deepEqual(
    coreAssetReadinessFailures({
      sourceRows: 100,
      coreRows: 100,
      sourceFirst: "A100",
      sourceLast: "XCP",
      coreFirst: "A100",
      coreLast: "XCP",
      done: true,
      sampleMatches: [true, true, true],
    }),
    [],
  );
});

test("core asset readiness fails closed on incomplete or mismatched data", () => {
  const failures = coreAssetReadinessFailures({
    sourceRows: 100,
    coreRows: 99,
    sourceFirst: "A100",
    sourceLast: "XCP",
    coreFirst: "A101",
    coreLast: "XCP",
    done: false,
    sampleMatches: [true, false],
  });
  assert.equal(failures.includes("asset backfill is incomplete"), true);
  assert.equal(failures.includes("asset row counts differ"), true);
  assert.equal(failures.includes("asset name extrema differ"), true);
  assert.equal(failures.includes("one or more decoded asset samples differ"), true);
});

test("core block readiness requires completion, count, extrema, and sample parity", () => {
  assert.deepEqual(
    coreBlockReadinessFailures({
      sourceRows: 100,
      coreRows: 100,
      sourceFirst: 278270,
      sourceLast: 278369,
      coreFirst: 278270,
      coreLast: 278369,
      done: true,
      sampleMatches: [true, true, true],
    }),
    [],
  );
  const failures = coreBlockReadinessFailures({
    sourceRows: 100,
    coreRows: 99,
    sourceFirst: 278270,
    sourceLast: 278369,
    coreFirst: 278271,
    coreLast: 278369,
    done: false,
    sampleMatches: [false],
  });
  assert.equal(failures.length, 4);
});

test("core issuance readiness requires a complete matching event projection", () => {
  assert.deepEqual(
    coreIssuanceReadinessFailures({
      sourceRows: 562_339,
      coreRows: 562_339,
      sourceFirst: 100,
      sourceLast: 900_000,
      coreFirst: 100,
      coreLast: 900_000,
      done: true,
      sampleMatches: [true, true, true],
    }),
    [],
  );
  const failures = coreIssuanceReadinessFailures({
    sourceRows: 562_339,
    coreRows: 562_338,
    sourceFirst: 100,
    sourceLast: 900_000,
    coreFirst: 101,
    coreLast: 900_000,
    done: false,
    sampleMatches: [true, false],
  });
  assert.equal(failures.length, 4);
});
