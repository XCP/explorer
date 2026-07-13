import assert from "node:assert/strict";
import { test } from "node:test";
import { auditRecoveryR2Page, auditRecoveryTransactionObjects } from "#api/recovery/r2-audit";

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

test("R2 audit pages retain the final checked cursor when the page is terminal", async () => {
  const first = "11".repeat(32);
  const second = "22".repeat(32);
  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [{ txid: first }, { txid: second }] };
        },
      };
    },
  } as unknown as D1Database;
  const result = await auditRecoveryR2Page({ RECOVERY_DB: db, RECOVERY_TRANSACTIONS: bucket(new Map()) }, "", 3);
  assert.equal(result.last_cursor, second);
  assert.equal(result.next_cursor, null);
});
