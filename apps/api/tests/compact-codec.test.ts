import { test } from "node:test";
import assert from "node:assert/strict";
import { hashToBytes, parseMatchId, parseUtxoHolder } from "#api/indexer/compact-codec";

test("hashToBytes stores a hex transaction hash as its 32 raw bytes", () => {
  const hash = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  assert.deepEqual([...hashToBytes(hash)!], [...Array(32).keys()]);
  assert.equal(hashToBytes(null), null);
});

test("hashToBytes rejects malformed hashes instead of storing ambiguous data", () => {
  let message = "";
  try {
    hashToBytes("1234");
  } catch (error) {
    message = (error as Error).message;
  }
  assert.equal(message, "invalid transaction hash");
});

test("UTXO balance holders decode to an exact transaction hash and vout", () => {
  const txid = "ab".repeat(32);
  const parsed = parseUtxoHolder(`${txid}:17`);
  assert.equal(Array.from(parsed.txHash, (byte) => byte.toString(16).padStart(2, "0")).join(""), txid);
  assert.equal(parsed.vout, 17);
  assert.throws(() => parseUtxoHolder(`${txid}:-1`), /invalid UTXO balance holder/);
  assert.throws(() => parseUtxoHolder(`not-a-txid:0`), /invalid UTXO balance holder/);
});

test("match ids decode both transaction hashes without storing the joined string", () => {
  const tx0 = "12".repeat(32);
  const tx1 = "34".repeat(32);
  const parsed = parseMatchId(`${tx0}_${tx1}`);
  assert.deepEqual([...parsed.tx0Hash], [...hashToBytes(tx0)!]);
  assert.deepEqual([...parsed.tx1Hash], [...hashToBytes(tx1)!]);
  assert.throws(() => parseMatchId(`${tx0}:${tx1}`), /invalid match id/);
});
