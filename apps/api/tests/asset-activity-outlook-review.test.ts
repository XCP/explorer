import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUBGROUP_SQL,
  REVIEW_SQL,
  COLLECTION_SQL,
  buildReview,
  leaveCollectionOutSql,
} from "#ops/review-asset-activity-outlook";
import { OUTLOOK_INVARIANT_SQL, buildOutlookAudit } from "#ops/audit-asset-activity-outlook";

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
  assert.match(COLLECTION_SQL, /current|collection/i);
  assert.match(leaveCollectionOutSql("rare-pepe"), /collection<>'rare-pepe'/);
});

test("asset outlook production audit enforces ranked-product eligibility", () => {
  assert.match(OUTLOOK_INVARIANT_SQL, /low_quality=0/);
  assert.match(OUTLOOK_INVARIANT_SQL, /ineligible_rows/);
  const base = {
    missing_rows: 0,
    stale_rows: 0,
    ineligible_rows: 0,
    invalid_rows: 0,
    eligible_assets: 2,
    projection_rows: 2,
    distinct_ranks: 2,
    min_rank: 1,
    max_rank: 2,
    distinct_populations: 1,
    stored_population: 2,
  };
  assert.equal(buildOutlookAudit(base, []).healthy, true);
  assert.equal(buildOutlookAudit({ ...base, ineligible_rows: 1 }, []).healthy, false);
});

test("asset outlook review documents its horizon and avoids categorical cutoffs", () => {
  const report = buildReview([], []);
  assert.equal(report.horizon_days, 180);
  assert.match(report.model, /active-month/);
  assert.match(report.subgroup_buckets, /no hand-selected/);
  assert.match(report.collection_note, /post-hoc diagnostic/);
});
