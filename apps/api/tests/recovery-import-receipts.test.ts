import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceImportFrontier } from "#api/recovery/import-receipts";

test("recovery receipt frontier ignores future pages until the gap arrives", () => {
  assert.deepEqual(
    advanceImportFrontier(100, [
      { page_cursor: 200, next_cursor: 300 },
      { page_cursor: 100, next_cursor: 200 },
    ]),
    { cursor: 300, complete: false },
  );
});

test("recovery receipt frontier reaches a terminal page exactly once", () => {
  assert.deepEqual(
    advanceImportFrontier(100, [
      { page_cursor: 100, next_cursor: 200 },
      { page_cursor: 200, next_cursor: null },
      { page_cursor: 100, next_cursor: 200 },
    ]),
    { cursor: 200, complete: true },
  );
});

test("recovery receipt frontier rejects non-advancing chains", () => {
  assert.throws(() => advanceImportFrontier(100, [{ page_cursor: 100, next_cursor: 100 }]), /did not advance/);
});
