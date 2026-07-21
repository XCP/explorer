import assert from "node:assert/strict";
import { test } from "node:test";
import { routeFamily } from "#api/http/telemetry";

test("routeFamily produces bounded labels without entity identifiers", () => {
  assert.equal(routeFamily("/v2/assets/XCP"), "/v2/assets/:detail");
  assert.equal(routeFamily("/v2/trades"), "/v2/trades");
  assert.equal(routeFamily("/admin/bitcoin-fees"), "/admin/bitcoin-fees");
  assert.equal(routeFamily("/api/v1/asset/XCP"), "/api/v1/:legacy");
  assert.equal(routeFamily("/.env"), "/:unmatched");
});
