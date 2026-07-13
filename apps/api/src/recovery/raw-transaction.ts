import { sha256 } from "@noble/hashes/sha2.js";

export interface RecoveryTransactionOutput {
  valueSats: bigint;
  scriptPubkeyHex: string;
}

export interface ParsedRecoveryTransaction {
  txid: string;
  firstInputTxid: string;
  inputs: { txid: string; vout: number }[];
  outputs: RecoveryTransactionOutput[];
  output(index: number): RecoveryTransactionOutput | null;
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

class TransactionReader {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  read(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new Error("truncated Bitcoin transaction");
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  uint8(): number {
    return this.read(1)[0]!;
  }

  uint32(): number {
    const value = this.read(4);
    return (value[0]! | (value[1]! << 8) | (value[2]! << 16) | (value[3]! << 24)) >>> 0;
  }

  uint64(): bigint {
    const value = this.read(8);
    let result = 0n;
    for (let index = 7; index >= 0; index--) result = (result << 8n) | BigInt(value[index]!);
    return result;
  }

  compactSize(): number {
    const prefix = this.uint8();
    let value: bigint;
    if (prefix < 0xfd) return prefix;
    if (prefix === 0xfd) {
      const bytes = this.read(2);
      value = BigInt(bytes[0]! | (bytes[1]! << 8));
      if (value < 0xfdn) throw new Error("non-canonical compact size");
    } else if (prefix === 0xfe) {
      value = BigInt(this.uint32());
      if (value <= 0xffffn) throw new Error("non-canonical compact size");
    } else {
      value = this.uint64();
      if (value <= 0xffffffffn) throw new Error("non-canonical compact size");
    }
    if (value > MAX_SAFE_BIGINT) throw new Error("compact size exceeds safe parser limits");
    return Number(value);
  }
}

function decodeHex(value: string): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error("raw transaction must be non-empty hexadecimal bytes");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function encodeHex(value: Uint8Array): string {
  let result = "";
  for (const byte of value) result += byte.toString(16).padStart(2, "0");
  return result;
}

function reverse(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value).reverse();
}

function transactionId(serialized: Uint8Array): string {
  return encodeHex(reverse(sha256(sha256(serialized))));
}

export function parseRecoveryTransaction(rawTransactionHex: string): ParsedRecoveryTransaction {
  const bytes = decodeHex(rawTransactionHex);
  const reader = new TransactionReader(bytes);
  const version = reader.read(4);
  let inputStart = reader.offset;
  let inputCount = reader.compactSize();
  let hasWitness = false;
  if (inputCount === 0) {
    const flag = reader.uint8();
    if (flag !== 1) throw new Error("unsupported Bitcoin transaction witness flag");
    hasWitness = true;
    inputStart = reader.offset;
    inputCount = reader.compactSize();
  }
  if (inputCount === 0) throw new Error("recovery transaction has no inputs");
  if (inputCount > reader.remaining / 41) throw new Error("invalid Bitcoin transaction input count");

  const inputs: { txid: string; vout: number }[] = [];
  for (let index = 0; index < inputCount; index++) {
    const txid = encodeHex(reverse(reader.read(32)));
    const vout = reader.uint32();
    const scriptLength = reader.compactSize();
    reader.read(scriptLength);
    reader.read(4); // sequence
    inputs.push({ txid, vout });
  }
  const inputEnd = reader.offset;

  const outputStart = reader.offset;
  const outputCount = reader.compactSize();
  if (outputCount > reader.remaining / 9) throw new Error("invalid Bitcoin transaction output count");
  const outputs: RecoveryTransactionOutput[] = [];
  for (let index = 0; index < outputCount; index++) {
    const valueSats = reader.uint64();
    const scriptLength = reader.compactSize();
    outputs.push({ valueSats, scriptPubkeyHex: encodeHex(reader.read(scriptLength)) });
  }
  const outputEnd = reader.offset;

  if (hasWitness) {
    let hasWitnessStack = false;
    for (let inputIndex = 0; inputIndex < inputCount; inputIndex++) {
      const itemCount = reader.compactSize();
      if (itemCount > 0) hasWitnessStack = true;
      if (itemCount > reader.remaining) throw new Error("invalid Bitcoin transaction witness item count");
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) reader.read(reader.compactSize());
    }
    if (!hasWitnessStack) throw new Error("superfluous Bitcoin transaction witness encoding");
  }
  const locktime = reader.read(4);
  if (reader.remaining !== 0) throw new Error("trailing bytes after Bitcoin transaction");

  const stripped = hasWitness
    ? Uint8Array.from([
        ...version,
        ...bytes.subarray(inputStart, inputEnd),
        ...bytes.subarray(outputStart, outputEnd),
        ...locktime,
      ])
    : bytes;
  return {
    txid: transactionId(stripped),
    firstInputTxid: inputs[0]!.txid,
    inputs,
    outputs,
    output(index) {
      return Number.isSafeInteger(index) && index >= 0 ? (outputs[index] ?? null) : null;
    },
  };
}
