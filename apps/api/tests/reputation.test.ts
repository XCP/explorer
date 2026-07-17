import assert from "node:assert/strict";
import { test } from "node:test";
import { ADDRESS_FACTORS, ADDRESS_PCT, ADDRESS_TIERS, SCALARS } from "#api/reputation/config";
import {
  addressScore,
  addressTier,
  percentile,
  rawSqlExpr,
  scoreAddress,
  scoreConviction,
} from "#api/reputation/score";

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9);

test("address scoring is finite, config-driven, and applies the modern activity bonus once", () => {
  const row = { first_block: 300_000, last_block: SCALARS.modernActiveBlock, survived_assets: 5, assets_held: 40 };
  const result = scoreAddress(row, 960_000);
  assert.ok(Number.isFinite(result.raw));
  assert.equal(result.breakdown.modern, SCALARS.modernActiveBonus);
  const labels = new Set(ADDRESS_FACTORS.filter((factor) => factor.weight).map((factor) => factor.label));
  for (const key of Object.keys(result.breakdown)) assert.ok(key === "modern" || labels.has(key));
});

test("address tiers and percentile anchors retain exact boundary behavior", () => {
  near(percentile(ADDRESS_PCT.floor, ADDRESS_PCT), 0);
  near(percentile(ADDRESS_PCT.p50, ADDRESS_PCT), 50);
  near(percentile(ADDRESS_PCT.p90, ADDRESS_PCT), 90);
  assert.equal(addressScore(ADDRESS_PCT.floor), 0);
  for (const tier of ADDRESS_TIERS) {
    if (tier.minRaw <= -1e8) continue;
    assert.equal(addressTier(tier.minRaw, "ranked"), tier.tier);
    assert.notEqual(addressTier(tier.minRaw - 1e-9, "ranked"), tier.tier);
  }
  assert.equal(addressTier(1e6, "exchange"), "Exchange");
  assert.equal(addressTier(1e6, "burn"), "Burn");
});

test("population SQL remains literal-only and omits the row-only XCP field", () => {
  const expression = rawSqlExpr(ADDRESS_FACTORS, 912_345);
  assert.ok(expression.includes("912345"));
  assert.ok(!expression.includes("?"));
  assert.ok(!/\bxcp\b/i.test(expression));
});

test("Conviction remains separate, scarcity-aware, and fails closed on integrity", () => {
  assert.deepEqual(scoreConviction({ low_quality: 1, supply: 10, holders: 20 }), { raw: 0, breakdown: {} });
  const ordinary = scoreConviction({ low_quality: 0, supply: 100, burned_pct: 0, holders: 20 });
  assert.ok(Number.isFinite(ordinary.raw));
  assert.ok("scarcity" in ordinary.breakdown);
});
