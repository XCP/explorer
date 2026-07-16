import assert from "node:assert/strict";
import { test } from "node:test";
import { addressCurrentActivity } from "#api/reputation/activity";

const DAY = 86_400;
const NOW = 1_800_000_000;

test("address current activity reports exact factual recency without categorical cutoffs", () => {
  assert.equal(addressCurrentActivity(null, NOW), null);
  assert.equal(addressCurrentActivity(NOW, null), null);
  assert.equal(addressCurrentActivity(NOW + DAY, NOW)?.days_since_active, 0);
  assert.equal(addressCurrentActivity(NOW - 31 * DAY, NOW)?.days_since_active, 31);
  assert.deepEqual(addressCurrentActivity(NOW - 366 * DAY, NOW), {
    last_active_at: NOW - 366 * DAY,
    days_since_active: 366,
  });
});
