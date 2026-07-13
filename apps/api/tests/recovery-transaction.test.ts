import { test } from "node:test";
import assert from "node:assert/strict";
import { Transaction } from "@scure/btc-signer";
import { hex } from "@scure/base";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";

test("recovery transaction parsing exposes canonical txid, first input, and exact output", () => {
  const previousTxid = "12".repeat(32);
  const script = "51" + "21" + "02" + "34".repeat(32) + "51ae";
  const transaction = new Transaction({ allowUnknownOutputs: true, disableScriptCheck: true });
  transaction.addInput({ txid: hex.decode(previousTxid), index: 7, sequence: 0xffffffff });
  transaction.addOutput({ amount: 1_000n, script: hex.decode(script) });
  const parsed = parseRecoveryTransaction(transaction.hex);

  assert.equal(parsed.txid, transaction.id);
  assert.equal(parsed.firstInputTxid, previousTxid);
  assert.deepEqual(parsed.inputs, [{ txid: previousTxid, vout: 7 }]);
  assert.deepEqual(parsed.outputs, [{ valueSats: 1_000n, scriptPubkeyHex: script }]);
  assert.deepEqual(parsed.output(0), { valueSats: 1_000n, scriptPubkeyHex: script });
  assert.equal(parsed.output(1), null);
});

test("recovery transaction parsing rejects malformed bytes", () => {
  assert.throws(() => parseRecoveryTransaction("00"), /Reader/);
});
