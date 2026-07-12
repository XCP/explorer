import { test } from "node:test";
import assert from "node:assert/strict";
import { hashToBytes } from "../src/indexer/compact-codec";

test("hashToBytes stores a hex transaction hash as its 32 raw bytes", () => {
  const hash = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  assert.deepEqual([...hashToBytes(hash)!], [...Array(32).keys()]);
  assert.equal(hashToBytes(null), null);
});

test("hashToBytes rejects malformed hashes instead of storing ambiguous data", () => {
  let message = "";
  try { hashToBytes("1234"); } catch (error) { message = (error as Error).message; }
  assert.equal(message, "invalid transaction hash");
});
