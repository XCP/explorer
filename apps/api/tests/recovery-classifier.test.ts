import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  classifyRecovery,
  isCurvePublicKey,
  p2pkhAddress,
  parseBareMultisig,
  verifyCounterpartyLayout,
} from "#api/recovery/classifier";

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const recoveryKey = hex(secp256k1.getPublicKey(new Uint8Array(32).fill(7), true));
const dataKeyA = hex(secp256k1.getPublicKey(new Uint8Array(32).fill(8), true));
const dataKeyB = hex(secp256k1.getPublicKey(new Uint8Array(32).fill(9), true));
const address = p2pkhAddress(recoveryKey)!;
const prefix = new TextEncoder().encode("CNTRPRTY");

function script(required: number, keys: string[]): string {
  return [
    (0x50 + required).toString(16),
    ...keys.flatMap((key) => [(key.length / 2).toString(16).padStart(2, "0"), key]),
    (0x50 + keys.length).toString(16),
    "ae",
  ].join("");
}

function rc4(key: Uint8Array, input: Uint8Array): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = new Uint8Array(input.length);
  let i = 0;
  j = 0;
  for (let offset = 0; offset < input.length; offset++) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[offset] = input[offset] ^ state[(state[i] + state[j]) & 0xff];
  }
  return output;
}

function validDataKey(data: Uint8Array): string {
  for (const sign of [2, 3]) {
    for (let nonce = 0; nonce < 256; nonce++) {
      const candidate = Uint8Array.from([sign, ...data, nonce]);
      const candidateHex = hex(candidate);
      if (isCurvePublicKey(candidateHex)) return candidateHex;
    }
  }
  throw new Error("unable to construct fixture public key");
}

function currentCounterpartyKeys(firstInputTxid: string): [string, string] {
  const plaintext = new Uint8Array(62);
  plaintext[0] = prefix.length + 3;
  plaintext.set(prefix, 1);
  plaintext.set(new TextEncoder().encode("abc"), 1 + prefix.length);
  const encrypted = rc4(Uint8Array.from(firstInputTxid.match(/../g)!.map((x) => Number.parseInt(x, 16))), plaintext);
  return [validDataKey(encrypted.slice(0, 31)), validDataKey(encrypted.slice(31))];
}

test("parses exact historical Counterparty 1-of-2 layout", () => {
  const historicalData = `${prefix.length.toString(16).padStart(2, "0")}${hex(prefix)}${"00".repeat(24)}`;
  const parsed = parseBareMultisig(script(1, [recoveryKey, historicalData]));
  assert.equal(parsed?.requiredSignatures, 1);
  assert.equal(parsed?.publicKeyCount, 2);
  assert.equal(isCurvePublicKey(historicalData), false);
  const result = classifyRecovery({
    scriptPubkeyHex: script(1, [recoveryKey, historicalData]),
    expectedAddress: address,
  });
  assert.equal(result.classification, "recoverable");
  assert.equal(result.recoveryKeyPosition, 0);
});

test("does not mistake modern curve-valid data keys for the recovery key", () => {
  const firstInputTxid = "11".repeat(32);
  const [encodedA, encodedB] = currentCounterpartyKeys(firstInputTxid);
  assert.equal(isCurvePublicKey(encodedA), true);
  assert.equal(isCurvePublicKey(encodedB), true);
  const result = classifyRecovery({
    scriptPubkeyHex: script(1, [encodedA, encodedB, recoveryKey]),
    firstInputTxid,
    expectedAddress: address,
  });
  assert.equal(result.classification, "recoverable");
  assert.equal(result.recoveryKeyHex, recoveryKey);
  assert.equal(result.recoveryKeyPosition, 2);
});

test("requires provenance and ownership proof before calling an output recoverable", () => {
  const firstInputTxid = "22".repeat(32);
  const [encodedA, encodedB] = currentCounterpartyKeys(firstInputTxid);
  const candidate = script(1, [encodedA, encodedB, recoveryKey]);
  assert.equal(classifyRecovery({ scriptPubkeyHex: candidate, expectedAddress: address }).classification, "unverified");
  assert.equal(
    classifyRecovery({ scriptPubkeyHex: candidate, firstInputTxid }).classification,
    "ambiguous",
  );
  assert.equal(
    classifyRecovery({
      scriptPubkeyHex: candidate,
      firstInputTxid,
      expectedAddress: p2pkhAddress(encodedA)!,
    }).classification,
    "invalid",
  );
});

test("keeps chain state separate from structural recoverability", () => {
  const firstInputTxid = "33".repeat(32);
  const [encodedA, encodedB] = currentCounterpartyKeys(firstInputTxid);
  const result = classifyRecovery({
    scriptPubkeyHex: script(1, [encodedA, encodedB, recoveryKey]),
    firstInputTxid,
    expectedAddress: address,
    spent: true,
  });
  assert.equal(result.classification, "spent");
  assert.equal(result.reason, "verified-output-already-spent");
});

test("rejects structurally similar 1-of-3 scripts without decodable Counterparty data", () => {
  const parsed = parseBareMultisig(script(1, [dataKeyA, dataKeyB, recoveryKey]))!;
  assert.equal(verifyCounterpartyLayout(parsed, "44".repeat(32)), null);
});

test("rejects malformed and multi-signature outputs", () => {
  assert.equal(classifyRecovery({ scriptPubkeyHex: "51ae" }).classification, "invalid");
  assert.equal(classifyRecovery({ scriptPubkeyHex: script(2, [dataKeyA, recoveryKey]) }).classification, "unsupported");
});
