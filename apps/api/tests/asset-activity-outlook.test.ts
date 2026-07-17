import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_OUTLOOK_REFRESH_SECONDS,
  ASSET_ACTIVITY_OUTLOOK_RECONCILE_SQL,
  ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL,
  activityOutlookRefreshDue,
} from "#api/indexer/asset-activity-outlook";
import { assetActivityOutlook } from "#api/reputation/activity-outlook";

test("activity outlook refresh is daily and exact at the boundary", () => {
  assert.equal(activityOutlookRefreshDue(100, 0), true);
  assert.equal(activityOutlookRefreshDue(100 + ACTIVITY_OUTLOOK_REFRESH_SECONDS - 1, 100), false);
  assert.equal(activityOutlookRefreshDue(100 + ACTIVITY_OUTLOOK_REFRESH_SECONDS, 100), true);
});

test("activity outlook uses the validated equal-weight rank and convergent upsert", () => {
  assert.match(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL, /PERCENT_RANK\(\).*last_trade_time/);
  assert.match(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL, /PERCENT_RANK\(\).*active_trade_months/);
  assert.match(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL, /\(recency_pct\+active_months_pct\)\/2\.0/);
  assert.match(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL, /ON CONFLICT\(asset_id\) DO UPDATE/);
  assert.match(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL, /low_quality=0/);
  assert.equal(/DELETE|REPLACE/i.test(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL), false);
  assert.match(ASSET_ACTIVITY_OUTLOOK_RECONCILE_SQL, /NOT EXISTS/);
  assert.match(ASSET_ACTIVITY_OUTLOOK_RECONCILE_SQL, /low_quality=0/);
});

test("activity outlook rejects stale reorg rows and invalid projection invariants", () => {
  const valid = {
    active_trade_months: 4,
    activity_outlook_score: 91.26,
    activity_outlook_rank: 10,
    activity_outlook_population: 100,
    activity_outlook_calculated_at: 123,
  };
  assert.deepEqual(assetActivityOutlook(valid), {
    score: 91.3,
    rank: 10,
    population: 100,
    horizon_days: 180,
    calculated_at: 123,
  });
  assert.equal(assetActivityOutlook({ ...valid, active_trade_months: 0 }), null);
  assert.equal(assetActivityOutlook({ ...valid, activity_outlook_score: 101 }), null);
  assert.equal(assetActivityOutlook({ ...valid, activity_outlook_rank: 101 }), null);
});
