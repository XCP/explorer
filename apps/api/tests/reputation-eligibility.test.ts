import assert from "node:assert/strict";
import { test } from "node:test";
import { assetRankingEligible, assetRankingEligibleSql } from "#api/reputation/eligibility";
import {
  ASSET_ACTIVITY_OUTLOOK_RECONCILE_SQL,
  ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL,
} from "#api/indexer/asset-activity-outlook";

test("ranked asset products share one low-quality eligibility contract", () => {
  assert.equal(assetRankingEligible(0), true);
  assert.equal(assetRankingEligible(null), true);
  assert.equal(assetRankingEligible(1), false);
  assert.equal(assetRankingEligibleSql("signal"), "COALESCE(signal.low_quality,0)=0");
  assert.match(ASSET_ACTIVITY_OUTLOOK_UPSERT_SQL, /COALESCE\(signal\.low_quality,0\)=0/);
  assert.match(ASSET_ACTIVITY_OUTLOOK_RECONCILE_SQL, /COALESCE\(signal\.low_quality,0\)=0/);
});
