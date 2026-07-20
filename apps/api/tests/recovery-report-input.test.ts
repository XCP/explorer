import { test } from "node:test";
import assert from "node:assert/strict";
import { isRecoveryReportInput } from "#api/recovery/read";

const address = "1BitcoinEaterAddressDontSendf59kuE";
const recoveryTxid = "1".repeat(64);

test("a recovery report accepts an available input owned by its address", () => {
  assert.equal(
    isRecoveryReportInput({ recovery_address: address, classification: "recoverable" }, address, recoveryTxid),
    true,
  );
});

test("a confirmed recovery can replay only the input it actually spent", () => {
  assert.equal(
    isRecoveryReportInput(
      { recovery_address: address, classification: "spent", spent_by_txid: recoveryTxid },
      address,
      recoveryTxid,
    ),
    true,
  );
  assert.equal(
    isRecoveryReportInput(
      { recovery_address: address, classification: "spent", spent_by_txid: "2".repeat(64) },
      address,
      recoveryTxid,
    ),
    false,
  );
});

test("a recovery report never accepts another address's input", () => {
  assert.equal(
    isRecoveryReportInput(
      { recovery_address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", classification: "recoverable" },
      address,
      recoveryTxid,
    ),
    false,
  );
});
