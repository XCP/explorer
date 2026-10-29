import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { classifyRecoveryTransaction } from "#api/recovery/classifier";
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

test("a mainnet historical transaction proves its same-key continuation output", () => {
  // 00020d9f233711d6bbb3e0911e040c34333dc3350f506631dda4140b88136445, block 309517.
  const mainnetRaw = [
    "0100000003a7ceb25da17704a9d59492d5afedca96cd92cb5384a76a7facaa6ed841dcfb55000000006b483045022100",
    "8259b8fbde0efb3476d5da3f85a7d2bf1bb3cef8d9360732105216dab308195f02207f9f044ee481d9bb520c09b4380a",
    "0dd614afab72b4e852fac745bf158b8d0bfe012103dd0a32844c876e518ca979ae88bc6b6461b6920292570a20e73ba25",
    "e26353744ffffffff7397054a9c8f4c9d064937e67166bfa4eb2cc9c0b10b28ade978bc63abda9aa5000000006a473044",
    "02207d0d62d5082c21ad2c71830a7a7cb8498494eb9bf59ab0936ab84b122bcf57600220195dfb25a5d1673b42e1db45",
    "4908182ab5f46efe66071dc4b36f4622e3027442012103dd0a32844c876e518ca979ae88bc6b6461b6920292570a20e73",
    "ba25e26353744ffffffff06823da927be1f104ad942f1e90b90335e9811bfed8ae31341efd0e8b4af2b15020000006c49",
    "3046022100893bc7c92ab4f2a4d8e9741399ec541ed6e22eb34dbe8bab92c59b157a3fd45c022100f9ebe22aa2678d4b",
    "2a79ab532eed06dfcd2595985db69fb1a9f2b198937af127012103dd0a32844c876e518ca979ae88bc6b6461b692029257",
    "0a20e73ba25e26353744ffffffff03781e00000000000047512103dd0a32844c876e518ca979ae88bc6b6461b692029257",
    "0a20e73ba25e263537442120434e54525052545900000046152bafb4e8d0ef4113e38aedbf11985e33900be952ae781e00",
    "000000000047512103dd0a32844c876e518ca979ae88bc6b6461b6920292570a20e73ba25e26353744210cf142d94a101",
    "fbe27a93d8206000000000000000000000000000000000000000052aee4220d00000000001976a914861fb119c717ea89",
    "dd06002cb84ba69f775738bd88ac00000000",
  ].join("");
  const candidates = recoveryCandidates(mainnetRaw, 309_517, 1_404_730_309);
  const decisions = classifyRecoveryTransaction(
    candidates.map((candidate) => ({
      vout: candidate.vout,
      scriptPubkeyHex: candidate.script_pubkey_hex,
    })),
  );

  assert.equal(candidates.length, 2);
  assert.deepEqual(
    decisions.map((decision) => ({
      classification: decision.classification,
      reason: decision.reason,
      address: decision.derivedAddress,
    })),
    [
      {
        classification: "recoverable",
        reason: "verified-counterparty-recovery-output",
        address: "1DEBWh2YhUFPZBNvJjxZ9a4fixHn8ZMk4b",
      },
      {
        classification: "recoverable",
        reason: "verified-historical-continuation-output",
        address: "1DEBWh2YhUFPZBNvJjxZ9a4fixHn8ZMk4b",
      },
    ],
  );
});
