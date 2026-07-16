import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTLOOK_INVARIANT_SQL, OUTLOOK_CONCENTRATION_SQL, buildOutlookAudit } from "#ops/audit-asset-activity-outlook";

test("activity outlook audit covers completeness, stale rows, ranks, and drift inputs", () => {
  for (const token of [
    "missing_rows",
    "stale_rows",
    "invalid_rows",
    "distinct_ranks",
    "median_active_months",
    "median_recency_days",
  ])
    assert.match(OUTLOOK_INVARIANT_SQL, new RegExp(token));
  assert.match(OUTLOOK_CONCENTRATION_SQL, /rank_position<=100/);
  assert.match(OUTLOOK_CONCENTRATION_SQL, /collection/);
});

test("activity outlook audit fails closed on any projection mismatch", () => {
  const valid = {
    eligible_assets: 10,
    projection_rows: 10,
    missing_rows: 0,
    stale_rows: 0,
    invalid_rows: 0,
    distinct_ranks: 10,
    min_rank: 1,
    max_rank: 10,
    distinct_populations: 1,
    stored_population: 10,
  };
  assert.equal(buildOutlookAudit(valid, []).healthy, true);
  assert.equal(buildOutlookAudit({ ...valid, stale_rows: 1 }, []).healthy, false);
  assert.equal(buildOutlookAudit({ ...valid, distinct_ranks: 9 }, []).healthy, false);
});
