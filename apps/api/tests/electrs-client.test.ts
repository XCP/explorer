import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseElectrsBlockPage,
  parseElectrsOutspends,
  parseElectrsTransactionFee,
  parseElectrsTransactionHex,
  parseElectrsTransactionStatus,
} from "#api/integrations/electrs";

test("parses exact integer transaction fees", () => {
  assert.equal(parseElectrsTransactionFee({ fee: 46_970 }), 46_970);
  assert.throws(() => parseElectrsTransactionFee({ fee: -1 }), /invalid fee/);
  assert.throws(() => parseElectrsTransactionFee({ fee: 1.5 }), /invalid fee/);
  assert.throws(() => parseElectrsTransactionFee({ fee: "46970" }), /invalid fee/);
});

test("parses and normalizes raw transaction hex", () => {
  assert.equal(parseElectrsTransactionHex("00Aaff"), "00aaff");
  assert.throws(() => parseElectrsTransactionHex("abc"), /invalid/);
  assert.throws(() => parseElectrsTransactionHex("not-hex"), /invalid/);
});

test("Electrs block parsing preserves Bitcoin transaction totals", () => {
  assert.deepEqual(parseElectrsBlockPage([{ height: 958_084, tx_count: 3_174 }]), [
    { height: 958_084, transactionCount: 3_174 },
  ]);
  assert.throws(() => parseElectrsBlockPage([{ height: 1, tx_count: "3" }]), /invalid transaction count/);
});

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
