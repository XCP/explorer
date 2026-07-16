import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBGROUP_SQL, REVIEW_SQL, buildReview } from "#ops/review-asset-activity-outlook";

test("asset outlook review is cutoff-safe and uses distribution-derived subgroups", () => {
  for (const sql of [SUBGROUP_SQL, REVIEW_SQL]) {
    assert.match(sql, /trade\.block_time<=1767225600/);
    assert.match(sql, /trade\.block_time>1767225600/);
    assert.match(sql, /trade\.block_time<=1782777600/);
    assert.equal(/asset_signals|low_quality|graph_/.test(sql), false);
  }
  assert.match(SUBGROUP_SQL, /NTILE\(4\)/);
  assert.match(SUBGROUP_SQL, /NTILE\(10\)/);
  assert.match(REVIEW_SQL, /top_false_positive/);
});

test("asset outlook review documents its horizon and avoids categorical cutoffs", () => {
  const report = buildReview([], []);
  assert.equal(report.horizon_days, 180);
  assert.match(report.model, /active-month/);
  assert.match(report.subgroup_buckets, /no hand-selected/);
});
