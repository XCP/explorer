import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSignalStepCursor } from "#api/indexer/signals";

test("named signal cursor survives unit insertion and reordering", () => {
  assert.equal(resolveSignalStepCursor(["new", "first", "next"], "next", "1"), 2);
  assert.equal(resolveSignalStepCursor(["next", "first"], "next", "99"), 0);
});

test("signal cursor converts a valid legacy index and fails closed after unit removal", () => {
  assert.equal(resolveSignalStepCursor(["first", "next", "last"], null, "1"), 1);
  assert.equal(resolveSignalStepCursor(["first", "last"], "removed", null), 0);
  assert.equal(resolveSignalStepCursor(["first"], null, "invalid"), 0);
});
