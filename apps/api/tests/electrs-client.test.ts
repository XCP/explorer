import { test } from "node:test";
import assert from "node:assert/strict";
import { parseElectrsOutspends, parseElectrsTransactionStatus } from "#api/integrations/electrs";

test("Electrs outspend parsing preserves confirmed spending evidence", () => {
  assert.deepEqual(
    parseElectrsOutspends([
      { spent: false },
      { spent: true, txid: "ab".repeat(32), vin: 2, status: { confirmed: true, block_height: 900_000 } },
    ]),
    [
      { spent: false, txid: null, block_height: null },
      { spent: true, txid: "ab".repeat(32), block_height: 900_000 },
    ],
  );
});

test("Electrs outspend parsing rejects provider drift", () => {
  assert.throws(() => parseElectrsOutspends({}), /must be an array/);
  assert.throws(() => parseElectrsOutspends([{ spent: "false" }]), /missing spent state/);
});

test("Electrs transaction parsing preserves confirmation evidence", () => {
  assert.deepEqual(
    parseElectrsTransactionStatus({
      status: { confirmed: true, block_height: 900_000, block_hash: "ab".repeat(32), block_time: 1_700_000_000 },
    }),
    {
      confirmed: true,
      blockHeight: 900_000,
      blockHash: "ab".repeat(32),
      blockTime: 1_700_000_000,
    },
  );
  assert.deepEqual(parseElectrsTransactionStatus({ status: { confirmed: false } }), {
    confirmed: false,
    blockHeight: null,
    blockHash: null,
    blockTime: null,
  });
  assert.throws(() => parseElectrsTransactionStatus({ status: { confirmed: true } }), /missing block evidence/);
});
