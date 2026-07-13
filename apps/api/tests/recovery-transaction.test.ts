import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";

const input = `${"12".repeat(32)}0700000000ffffffff`;
const output = "e8030000000000000151";
const stripped = `0100000001${input}01${output}00000000`;
const strippedTxid = "bc761cf44ce5d3fc91e01ab5554899d85fa6573d67ac1ab0606af3f149c27962";

test("recovery transaction parsing exposes a legacy transaction's canonical txid and exact values", () => {
  const parsed = parseRecoveryTransaction(stripped);

  assert.equal(parsed.txid, strippedTxid);
  assert.equal(parsed.firstInputTxid, "12".repeat(32));
  assert.deepEqual(parsed.inputs, [{ txid: "12".repeat(32), vout: 7 }]);
  assert.deepEqual(parsed.outputs, [{ valueSats: 1_000n, scriptPubkeyHex: "51" }]);
  assert.deepEqual(parsed.output(0), { valueSats: 1_000n, scriptPubkeyHex: "51" });
  assert.equal(parsed.output(1), null);
});

test("recovery transaction parsing excludes SegWit data from the canonical txid", () => {
  const raw = `01000000000101${input}01${output}0201aa02bbcc00000000`;
  const parsed = parseRecoveryTransaction(raw);

  assert.equal(parsed.txid, strippedTxid);
  assert.deepEqual(parsed.inputs, [{ txid: "12".repeat(32), vout: 7 }]);
  assert.deepEqual(parsed.outputs, [{ valueSats: 1_000n, scriptPubkeyHex: "51" }]);
});

test("recovery transaction parsing supports exact uint64 output values", () => {
  const raw = `0100000001${input}01ffffffffffffffff015100000000`;
  assert.equal(parseRecoveryTransaction(raw).outputs[0]?.valueSats, 0xffffffffffffffffn);
});

test("recovery transaction parsing rejects malformed encodings", () => {
  assert.throws(() => parseRecoveryTransaction("00"), /truncated/);
  assert.throws(() => parseRecoveryTransaction(`${stripped}00`), /trailing bytes/);
  assert.throws(() => parseRecoveryTransaction(`01000000fd0100${input}01${output}00000000`), /non-canonical/);
  assert.throws(() => parseRecoveryTransaction(`01000000000201${input}01${output}00000000`), /witness flag/);
  assert.throws(() => parseRecoveryTransaction(`01000000000101${input}01${output}0000000000`), /superfluous.*witness/);
});
