import assert from "node:assert/strict";
import { test } from "node:test";
import { validBitcoinFeeRows } from "#api/indexer/bitcoin-fees";

const txHash = "1db7a85e9bbbcd9f60a62411e94f1ae8d3851642d0e3ca73e095d522bf234293";

test("accepts exact non-negative satoshi fees", () => {
  assert.deepEqual(validBitcoinFeeRows([{ tx_hash: txHash.toUpperCase(), fee: 46_970 }]), [
    { tx_hash: txHash, fee: 46_970 },
  ]);
  assert.deepEqual(validBitcoinFeeRows([{ tx_hash: txHash, fee: 0 }]), [{ tx_hash: txHash, fee: 0 }]);
});

test("rejects malformed fee batches", () => {
  assert.equal(validBitcoinFeeRows([]), null);
  assert.equal(validBitcoinFeeRows([{ tx_hash: txHash, fee: -1 }]), null);
  assert.equal(validBitcoinFeeRows([{ tx_hash: txHash, fee: 1.5 }]), null);
  assert.equal(validBitcoinFeeRows([{ tx_hash: "not-a-hash", fee: 1 }]), null);
});
