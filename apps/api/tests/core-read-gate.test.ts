import assert from "node:assert/strict";
import { test } from "node:test";
import { coreReadsEnabled } from "#api/read/core-read-gate";

function coreDb(state: Record<string, string>): D1Database {
  return {
    prepare() {
      return {
        async all() {
          return { results: Object.entries(state).map(([key, value]) => ({ key, value })) };
        },
      };
    },
  } as unknown as D1Database;
}

test("compact reads stay closed until every durable prerequisite is active", async () => {
  const ready = {
    parity_verified: "1",
    forward_write_ready: "1",
    read_surface_complete: "1",
    projection_writes_ready: "1",
  };
  assert.equal(await coreReadsEnabled({ CORE_DB: coreDb(ready) }), true);
  for (const key of Object.keys(ready)) {
    assert.equal(await coreReadsEnabled({ CORE_DB: coreDb({ ...ready, [key]: "0" }) }), false, key);
  }
  assert.equal(await coreReadsEnabled({ CORE_DB: coreDb({}) }), false);
});
