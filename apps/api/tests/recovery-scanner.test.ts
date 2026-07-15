import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { recoveryCandidates } from "#api/recovery/scanner";

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const recoveryKey = hex(secp256k1.getPublicKey(new Uint8Array(32).fill(7), true));
const prefix = hex(new TextEncoder().encode("CNTRPRTY"));
const dataKey = `08${prefix}${"00".repeat(24)}`;
const multisig = `51${(recoveryKey.length / 2).toString(16)}${recoveryKey}21${dataKey}52ae`;
const input = `${"12".repeat(32)}0000000000ffffffff`;
const littleEndianSats = "e803000000000000";
const raw = `0100000001${input}01${littleEndianSats}${(multisig.length / 2).toString(16)}${multisig}00000000`;

test("forward recovery scanner selects supported bare-multisig outputs with chain metadata", () => {
  assert.deepEqual(recoveryCandidates(raw, 900_000, 1_700_000_000), [
    {
      vout: 0,
      value_sats: 1_000,
      script_pubkey_hex: multisig,
      block_height: 900_000,
      block_time: 1_700_000_000,
    },
  ]);
});
