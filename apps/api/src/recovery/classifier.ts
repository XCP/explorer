import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58check } from "@scure/base";

export type CounterpartyMultisigLayout = "historical-1-of-2" | "current-1-of-3";
export type RecoveryClassification =
  | "recoverable"
  | "spent"
  | "ambiguous"
  | "unsupported"
  | "invalid"
  | "unverified";

export const RECOVERY_CLASSIFIER_VERSION = 1;

export interface ParsedBareMultisig {
  requiredSignatures: number;
  publicKeyCount: number;
  keyDataHex: string[];
}

export interface RecoveryEvidence {
  scriptPubkeyHex: string;
  expectedAddress?: string;
  firstInputTxid?: string;
  counterpartyPrefix?: Uint8Array;
  spent?: boolean;
}

export interface RecoveryDecision {
  classification: RecoveryClassification;
  reason: string;
  layout?: CounterpartyMultisigLayout;
  recoveryKeyHex?: string;
  recoveryKeyPosition?: number;
  derivedAddress?: string;
  parsed?: ParsedBareMultisig;
}

const hexPattern = /^[0-9a-f]+$/i;
const check = base58check(sha256);
const defaultCounterpartyPrefix = new TextEncoder().encode("CNTRPRTY");

function decodeHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !hexPattern.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

export function parseBareMultisig(scriptPubkeyHex: string): ParsedBareMultisig | null {
  const script = decodeHex(scriptPubkeyHex);
  if (!script || script.length < 4) return null;

  let offset = 0;
  const requiredOpcode = script[offset++];
  if (requiredOpcode < 0x51 || requiredOpcode > 0x60) return null;
  const requiredSignatures = requiredOpcode - 0x50;
  const keyDataHex: string[] = [];

  while (offset < script.length - 2) {
    const length = script[offset++];
    if (length !== 33 && length !== 65) return null;
    if (offset + length > script.length - 2) return null;
    keyDataHex.push(Array.from(script.slice(offset, offset + length), (byte) => byte.toString(16).padStart(2, "0")).join(""));
    offset += length;
  }

  if (offset + 2 !== script.length) return null;
  const countOpcode = script[offset++];
  if (countOpcode < 0x51 || countOpcode > 0x60 || script[offset] !== 0xae) return null;
  const publicKeyCount = countOpcode - 0x50;
  if (publicKeyCount !== keyDataHex.length || requiredSignatures > publicKeyCount) return null;

  return { requiredSignatures, publicKeyCount, keyDataHex };
}

export function isCurvePublicKey(publicKeyHex: string): boolean {
  try {
    secp256k1.Point.fromHex(publicKeyHex);
    return true;
  } catch {
    return false;
  }
}

export function p2pkhAddress(publicKeyHex: string): string | null {
  const publicKey = decodeHex(publicKeyHex);
  if (!publicKey || !isCurvePublicKey(publicKeyHex)) return null;
  const payload = new Uint8Array(21);
  payload.set(ripemd160(sha256(publicKey)), 1);
  return check.encode(payload);
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.length <= value.length && prefix.every((byte, index) => value[index] === byte);
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

export function verifyCounterpartyLayout(
  parsed: ParsedBareMultisig,
  firstInputTxid?: string,
  prefix: Uint8Array = defaultCounterpartyPrefix,
): CounterpartyMultisigLayout | null {
  if (parsed.requiredSignatures !== 1) return null;
  if (parsed.publicKeyCount === 2) {
    const data = decodeHex(parsed.keyDataHex[1]);
    if (!data || data[0] > data.length - 1) return null;
    return startsWith(data.slice(1, data[0] + 1), prefix) ? "historical-1-of-2" : null;
  }
  if (parsed.publicKeyCount !== 3 || !firstInputTxid) return null;
  const key = decodeHex(firstInputTxid);
  const first = decodeHex(parsed.keyDataHex[0]);
  const second = decodeHex(parsed.keyDataHex[1]);
  if (!key || key.length !== 32 || !first || !second || first.length !== 33 || second.length !== 33) return null;
  const encrypted = new Uint8Array(62);
  encrypted.set(first.slice(1, 32));
  encrypted.set(second.slice(1, 32), 31);
  const plaintext = rc4(key, encrypted);
  const dataLength = plaintext[0];
  if (dataLength > plaintext.length - 1) return null;
  return startsWith(plaintext.slice(1, dataLength + 1), prefix) ? "current-1-of-3" : null;
}

export function classifyRecovery(evidence: RecoveryEvidence): RecoveryDecision {
  const parsed = parseBareMultisig(evidence.scriptPubkeyHex);
  if (!parsed) return { classification: "invalid", reason: "malformed-bare-multisig-script" };
  if (parsed.requiredSignatures !== 1)
    return { classification: "unsupported", reason: "requires-more-than-one-signature", parsed };

  const structuralLayout =
    parsed.publicKeyCount === 2
      ? "historical-1-of-2"
      : parsed.publicKeyCount === 3
        ? "current-1-of-3"
        : undefined;
  if (!structuralLayout) return { classification: "unsupported", reason: "unsupported-key-count", parsed };
  const verifiedLayout = verifyCounterpartyLayout(parsed, evidence.firstInputTxid, evidence.counterpartyPrefix);
  if (!verifiedLayout)
    return { classification: "unverified", reason: "counterparty-provenance-not-verified", parsed };
  if (verifiedLayout !== structuralLayout)
    return { classification: "invalid", reason: "counterparty-layout-mismatch", layout: structuralLayout, parsed };

  const recoveryKeyPosition = structuralLayout === "historical-1-of-2" ? 0 : 2;
  const recoveryKeyHex = parsed.keyDataHex[recoveryKeyPosition];
  const derivedAddress = p2pkhAddress(recoveryKeyHex);
  if (!derivedAddress)
    return {
      classification: "invalid",
      reason: "recovery-key-is-not-a-valid-public-key",
      layout: structuralLayout,
      recoveryKeyHex,
      recoveryKeyPosition,
      parsed,
    };
  if (!evidence.expectedAddress)
    return {
      classification: "ambiguous",
      reason: "expected-owner-not-supplied",
      layout: structuralLayout,
      recoveryKeyHex,
      recoveryKeyPosition,
      derivedAddress,
      parsed,
    };
  if (derivedAddress !== evidence.expectedAddress)
    return {
      classification: "invalid",
      reason: "recovery-key-does-not-match-address",
      layout: structuralLayout,
      recoveryKeyHex,
      recoveryKeyPosition,
      derivedAddress,
      parsed,
    };

  return {
    classification: evidence.spent ? "spent" : "recoverable",
    reason: evidence.spent ? "verified-output-already-spent" : "verified-counterparty-recovery-output",
    layout: structuralLayout,
    recoveryKeyHex,
    recoveryKeyPosition,
    derivedAddress,
    parsed,
  };
}
