import assert from "node:assert/strict";
import { test } from "node:test";
import { auditRecoveryTransactionObjects } from "#api/recovery/r2-audit";

// One-input, one-output legacy transaction. Its body hash is independently fixed in the fixture key.
const input = `${"12".repeat(32)}0700000000ffffffff`;
const output = "e8030000000000000151";
const raw = `0100000001${input}01${output}00000000`;
const txid = "bc761cf44ce5d3fc91e01ab5554899d85fa6573d67ac1ab0606af3f149c27962";

function bucket(objects: Map<string, string>): R2Bucket {
  return {
    async get(key: string) {
      const value = objects.get(key);
      return value == null ? null : ({ text: async () => value } as R2ObjectBody);
    },
  } as R2Bucket;
}

test("R2 audit reports missing and body-hash mismatches", async () => {
  const other = "11".repeat(32);
  const result = await auditRecoveryTransactionObjects(
    bucket(
      new Map([
        [`transactions/${txid}.hex`, raw],
        [`transactions/${other}.hex`, raw],
      ]),
    ),
    [txid, other, "22".repeat(32)],
  );
  assert.equal(result.checked, 3);
  assert.deepEqual(result.missing, ["22".repeat(32)]);
  assert.deepEqual(result.corrupt, [{ txid: other, reason: `body hashes to ${txid}` }]);
});
