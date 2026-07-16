import assert from "node:assert/strict";
import { test } from "node:test";
import { qualityStatsRefreshDue } from "#api/indexer/quality-network-stats";
import { networkStatsCacheKey } from "#api/http/cache-keys";

test("quality stats refresh before the cached lifetime row expires", () => {
  const hour = 60 * 60;
  assert.equal(qualityStatsRefreshDue(10 * hour, 0), true);
  assert.equal(qualityStatsRefreshDue(10 * hour, 5 * hour), false);
  assert.equal(qualityStatsRefreshDue(11 * hour, 5 * hour), true);
});

test("quality stats reader and prewarmer share a schema-versioned cache identity", () => {
  assert.equal(networkStatsCacheKey(false), "stats:fee-completeness:0");
  assert.equal(networkStatsCacheKey(true), "stats:fee-completeness:1");
});
