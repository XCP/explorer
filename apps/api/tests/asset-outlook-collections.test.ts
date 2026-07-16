import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectionReport, evaluateCutoff } from "#ops/evaluate-asset-outlook-collections";

test("collection stability evaluation selects the dominant named top-100 cluster", () => {
  const responses = [
    { rows: [{ collection: "rare-pepe", top_100_assets: 80, top_100_returns: 70 }], meta: {} },
    { rows: [{ precision_at_100: 0.9 }], meta: {} },
    { rows: [{ precision_at_100: 0.4 }], meta: {} },
  ];
  const result = evaluateCutoff("test", 100, () => responses.shift()!);
  assert.equal(result.dominant_collection, "rare-pepe");
  assert.equal(result.dominant_top_100_assets, 80);
  assert.equal(result.baseline.precision_at_100, 0.9);
  assert.equal(result.leave_dominant_out.precision_at_100, 0.4);
});

test("collection stability report documents post-hoc labels", () => {
  const report = buildCollectionReport([]);
  assert.equal(report.horizon_days, 180);
  assert.match(report.collection_labels, /never model inputs/);
});
