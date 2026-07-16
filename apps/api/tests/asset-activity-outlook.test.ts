import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_OUTLOOK_REFRESH_SECONDS, activityOutlookRefreshDue } from "#api/indexer/asset-activity-outlook";

test("activity outlook refresh is daily and exact at the boundary", () => {
  assert.equal(activityOutlookRefreshDue(100, 0), true);
  assert.equal(activityOutlookRefreshDue(100 + ACTIVITY_OUTLOOK_REFRESH_SECONDS - 1, 100), false);
  assert.equal(activityOutlookRefreshDue(100 + ACTIVITY_OUTLOOK_REFRESH_SECONDS, 100), true);
});
