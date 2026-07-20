import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAddressSnapshot, percentileRanks, sha256, snapshotManifest } from "#ops/lib/reputation-snapshot";

test("snapshot percentile ranks match SQL PERCENT_RANK tie semantics", () => {
  const rows = [
    { id: 1, value: 10 },
    { id: 2, value: 10 },
    { id: 3, value: 20 },
  ];
  assert.deepEqual(
    [...percentileRanks(rows, "value").entries()],
    [
      [1, 0],
      [2, 0],
      [3, 1],
    ],
  );
});

test("offline address evaluation ranks deterministically and computes whole-ranking metrics", () => {
  const rows = [
    { id: 1, last_transaction_time: 40, past_active_months: 4, past_transactions: 8, future_transactions: 1 },
    { id: 2, last_transaction_time: 30, past_active_months: 3, past_transactions: 6, future_transactions: 1 },
    { id: 3, last_transaction_time: 20, past_active_months: 2, past_transactions: 4, future_transactions: 0 },
    { id: 4, last_transaction_time: 10, past_active_months: 1, past_transactions: 2, future_transactions: 0 },
  ];
  const result = evaluateAddressSnapshot(rows);
  assert.equal(result.length, 4);
  for (const predictor of result) {
    assert.equal(predictor.eligible, 4);
    assert.equal(predictor.positives, 2);
    assert.equal(predictor.population_return_rate, 0.5);
    assert.equal(predictor.return_lift, 2);
    assert.equal(predictor.average_precision, 1);
    assert.equal(predictor.ndcg, 1);
    assert.equal(predictor.at_1pct.precision, 1);
    assert.equal(predictor.at_1pct.recall, 0.5);
  }
});

test("snapshot manifest checksum binds chunk identity, counts, and contents", () => {
  const chunks = [
    { name: "a.ndjson", rows: 2, sha256: sha256("a") },
    { name: "b.ndjson", rows: 1, sha256: sha256("b") },
  ];
  const first = snapshotManifest({ cutoff: "2026-01-01", horizonDays: 180, frontier: "10", chunks, rows: 3 });
  const replay = snapshotManifest({ cutoff: "2026-01-01", horizonDays: 180, frontier: "10", chunks, rows: 3 });
  assert.equal(first.content_sha256, replay.content_sha256);
  assert.equal(first.schema, "xcp-reputation-snapshot/1");
  assert.notEqual(
    first.content_sha256,
    snapshotManifest({ cutoff: "2026-01-01", horizonDays: 180, frontier: "10", chunks: [...chunks].reverse(), rows: 3 })
      .content_sha256,
  );
});
