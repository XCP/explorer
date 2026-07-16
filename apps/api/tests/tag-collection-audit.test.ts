import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTION_PROFILE_SQL,
  COLLECTION_SOURCE_OVERLAP_SQL,
  COLLECTION_SOURCES,
  buildTagCollectionAudit,
} from "#ops/audit-tags-collections";

test("collection audit uses canonical tag unions and robust medians", () => {
  for (const source of COLLECTION_SOURCES) assert.match(COLLECTION_PROFILE_SQL, new RegExp(`'${source}'`));
  assert.match(COLLECTION_PROFILE_SQL, /PARTITION BY tag ORDER BY holders/);
  assert.match(COLLECTION_PROFILE_SQL, /median_holders/);
  assert.match(COLLECTION_PROFILE_SQL, /top_asset_event_pct/);
  assert.match(COLLECTION_SOURCE_OVERLAP_SQL, /HAVING COUNT\(DISTINCT source\)>1/);
});

test("collection audit explicitly remains descriptive", () => {
  const report = buildTagCollectionAudit([], [], []);
  assert.equal(report.schema, "xcp-tag-collection-audit/1");
  assert.match(report.methodology.profile, /not a quality grade/);
  assert.equal(report.methodology.minimum_members, 5);
});
