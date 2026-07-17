import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_RATING_MODEL_VERSION,
  ASSET_RATING_REFRESH_SECONDS,
  ASSET_RATING_RECONCILE_SQL,
  ASSET_RATING_UPSERT_SQL,
  assetRatingRefreshDue,
} from "#api/indexer/asset-rating";
import { assetRating } from "#api/reputation/rating";
import type { AssetSignalsRow } from "#api/storage-types";

test("Rating refresh is daily and uses one three-component 0–10 population rank", () => {
  assert.equal(assetRatingRefreshDue(100, 0), true);
  assert.equal(assetRatingRefreshDue(100 + ASSET_RATING_REFRESH_SECONDS - 1, 100), false);
  assert.equal(assetRatingRefreshDue(100 + ASSET_RATING_REFRESH_SECONDS, 100), true);
  for (const column of ["clean_active_trade_months", "distinct_paid_buyers", "clean_realized_usd"])
    assert.match(ASSET_RATING_UPSERT_SQL, new RegExp(`PERCENT_RANK\\(\\).*${column}`));
  assert.match(ASSET_RATING_UPSERT_SQL, /10\.0\*PERCENT_RANK\(\).*evidence_rank/);
  assert.match(ASSET_RATING_UPSERT_SQL, /ON CONFLICT\(asset_id\) DO UPDATE/);
  assert.match(ASSET_RATING_UPSERT_SQL, /COALESCE\(signal\.low_quality,0\)=0/);
  assert.equal(/REPLACE/i.test(ASSET_RATING_UPSERT_SQL), false);
  assert.match(ASSET_RATING_RECONCILE_SQL, /NOT EXISTS/);
});

test("public Rating is one literal value and fails closed on integrity or invalid projections", () => {
  const row = {
    low_quality: 0,
    rating_value: 8.24,
    rating_rank: 18,
    rating_population: 100,
    rating_active_months_score: 80.04,
    rating_buyer_breadth_score: 90.05,
    rating_realized_value_score: 70.06,
    rating_calculated_at: 123,
    rating_model_version: ASSET_RATING_MODEL_VERSION,
    clean_active_trade_months: 12,
    distinct_paid_buyers: 20,
    clean_realized_usd: 1234.567,
  } as AssetSignalsRow;
  assert.deepEqual(assetRating(row), {
    status: "rated",
    rating: 8.2,
    rank: 18,
    population: 100,
    calculated_at: 123,
    model_version: ASSET_RATING_MODEL_VERSION,
    evidence: { active_months: 12, independent_buyers: 20, realized_usd: 1234.57 },
    components: { active_months: 80, buyer_breadth: 90.1, realized_value: 70.1 },
  });
  assert.deepEqual(assetRating({ ...row, low_quality: 1 }), { status: "integrity_flag", rating: null });
  assert.deepEqual(assetRating({ ...row, rating_value: 11 }), { status: "not_rated", rating: null });
  assert.deepEqual(assetRating({ ...row, rating_rank: 101 }), { status: "not_rated", rating: null });
});
