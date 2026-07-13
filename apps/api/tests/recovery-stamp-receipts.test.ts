import assert from "node:assert/strict";
import { test } from "node:test";
import { completeStampReceiptChain } from "#api/recovery/stamp-receipts";

const snapshot = "aa".repeat(32);

test("official Stamp readiness requires one contiguous snapshot receipt chain", () => {
  const receipts = [
    { page_cursor: -1, next_cursor: 100, snapshot_sha256: snapshot },
    { page_cursor: 100, next_cursor: 250, snapshot_sha256: snapshot },
  ];
  assert.equal(completeStampReceiptChain(receipts, 100, 250, snapshot), true);
  assert.equal(completeStampReceiptChain(receipts.slice(1), 100, 250, snapshot), false);
  assert.equal(
    completeStampReceiptChain([receipts[0], { ...receipts[1], snapshot_sha256: "bb".repeat(32) }], 100, 250, snapshot),
    false,
  );
  assert.equal(completeStampReceiptChain(receipts, -1, 100, snapshot), false);
});
