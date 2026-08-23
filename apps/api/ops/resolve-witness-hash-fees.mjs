#!/usr/bin/env node
/**
 * Resolve Bitcoin fees for the pre-662000 Counterparty transactions whose `tx_hash` is a witness
 * hash (wtxid) rather than a txid, so no hash-indexed Bitcoin API can serve them.
 *
 * Counterparty recorded the wtxid as a transaction's identity for segwit transactions between the
 * `segwit_support` activation (block 557,236) and `correct_segwit_txids` (block 662,000). Those
 * identities are consensus history — upstream fixed the behaviour forward-only and can never rewrite
 * them — so the mirror keeps the wtxid (CLAUDE.md rule 7) and only the derived fee is repaired here.
 *
 * The mapping is recovered exactly: fetch each block's raw bytes, compute both the txid (serialization
 * without witness) and the wtxid (full serialization) for every transaction, and match ours by wtxid.
 * No Bitcoin node required. Writes a {tx_index, tx_hash, txid, fee} record per resolved row.
 *
 *   node ops/resolve-witness-hash-fees.mjs --rows=rows.json --out=fees.json
 *
 * Resumable: re-running skips rows already present in --out.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const arg = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const ROWS_PATH = arg("rows", "rows.json");
const OUT_PATH = arg("out", "fees.json");
const API = arg("api", "https://mempool.space/api").replace(/\/$/, "");
const BLOCK_CONCURRENCY = Number(arg("concurrency", "2"));
const PAUSE_MS = Number(arg("pause-ms", "250"));

const sha256 = (buffer) => createHash("sha256").update(buffer).digest();
const hash256 = (buffer) => sha256(sha256(buffer));
const littleEndianHex = (buffer) => Buffer.from(buffer).reverse().toString("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sequential reader over a raw block. */
class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }
  u8() {
    return this.buffer[this.offset++];
  }
  u32() {
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }
  u64() {
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
  varint() {
    const first = this.u8();
    if (first < 0xfd) return first;
    if (first === 0xfd) {
      const value = this.buffer.readUInt16LE(this.offset);
      this.offset += 2;
      return value;
    }
    if (first === 0xfe) return this.u32();
    return Number(this.u64());
  }
  skip(length) {
    this.offset += length;
  }
}

/**
 * Consume one transaction and return both identities. txid hashes version + inputs + outputs +
 * locktime; wtxid hashes the transaction exactly as serialized, marker/flag and witnesses included.
 */
function readTransaction(reader) {
  const start = reader.offset;
  const versionStart = reader.offset;
  reader.u32();
  const versionEnd = reader.offset;

  let segwit = false;
  if (reader.buffer[reader.offset] === 0x00 && reader.buffer[reader.offset + 1] === 0x01) {
    segwit = true;
    reader.skip(2);
  }

  const bodyStart = reader.offset;
  const inputCount = reader.varint();
  for (let index = 0; index < inputCount; index++) {
    reader.skip(36); // previous txid + vout
    reader.skip(reader.varint()); // scriptSig
    reader.u32(); // sequence
  }
  const outputCount = reader.varint();
  for (let index = 0; index < outputCount; index++) {
    reader.u64(); // value
    reader.skip(reader.varint()); // scriptPubKey
  }
  const bodyEnd = reader.offset;

  if (segwit)
    for (let input = 0; input < inputCount; input++) {
      const items = reader.varint();
      for (let item = 0; item < items; item++) reader.skip(reader.varint());
    }

  const locktimeStart = reader.offset;
  reader.u32();
  const end = reader.offset;

  const full = reader.buffer.subarray(start, end);
  const stripped = Buffer.concat([
    reader.buffer.subarray(versionStart, versionEnd),
    reader.buffer.subarray(bodyStart, bodyEnd),
    reader.buffer.subarray(locktimeStart, end),
  ]);
  return { txid: littleEndianHex(hash256(stripped)), wtxid: littleEndianHex(hash256(full)) };
}

async function get(path, kind) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(60_000) });
    if (response.ok) return kind === "buffer" ? Buffer.from(await response.arrayBuffer()) : await response.text();
    await response.body?.cancel();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= 4) throw new Error(`${path} ${response.status}`);
    await delay(Math.min(16_000, 1_000 * 2 ** attempt));
  }
}

/** Map every wtxid wanted in this block to its canonical txid. */
async function resolveBlock(height, wanted) {
  const blockHash = (await get(`/block-height/${height}`, "text")).trim();
  const raw = await get(`/block/${blockHash}/raw`, "buffer");
  const reader = new Reader(raw);
  reader.skip(80);
  const count = reader.varint();
  const remaining = new Map(wanted.map((row) => [row.tx_hash, row]));
  const resolved = [];
  for (let index = 0; index < count && remaining.size > 0; index++) {
    const { txid, wtxid } = readTransaction(reader);
    const row = remaining.get(wtxid) ?? remaining.get(txid);
    if (!row) continue;
    remaining.delete(row.tx_hash);
    resolved.push({ ...row, txid });
  }
  return { resolved, unresolved: [...remaining.values()] };
}

async function fetchFee(txid) {
  const transaction = JSON.parse(await get(`/tx/${txid}`, "text"));
  const fee = transaction.fee;
  if (!Number.isSafeInteger(fee) || fee < 0) throw new Error(`invalid fee for ${txid}`);
  return fee;
}

const rows = JSON.parse(readFileSync(ROWS_PATH, "utf8"));
const done = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, "utf8")) : [];
const doneIndexes = new Set(done.map((row) => row.tx_index));
const todo = rows.filter((row) => !doneIndexes.has(row.tx_index));

const byBlock = new Map();
for (const row of todo) {
  if (!byBlock.has(row.block_index)) byBlock.set(row.block_index, []);
  byBlock.get(row.block_index).push(row);
}

console.log(
  JSON.stringify({
    event: "start",
    rows: rows.length,
    already_done: done.length,
    todo: todo.length,
    blocks: byBlock.size,
  }),
);

const heights = [...byBlock.keys()];
const failures = [];
const unresolved = [];
let cursor = 0;
let completedBlocks = 0;

async function worker() {
  for (;;) {
    const slot = cursor++;
    if (slot >= heights.length) return;
    const height = heights[slot];
    const wanted = byBlock.get(height);
    try {
      const result = await resolveBlock(height, wanted);
      for (const row of result.resolved) {
        row.fee = await fetchFee(row.txid);
        done.push(row);
      }
      unresolved.push(...result.unresolved);
    } catch (error) {
      failures.push({ height, error: error instanceof Error ? error.message : String(error) });
    }
    completedBlocks++;
    if (completedBlocks % 10 === 0 || completedBlocks === heights.length) {
      writeFileSync(OUT_PATH, JSON.stringify(done, null, 1));
      console.log(
        JSON.stringify({
          event: "progress",
          blocks: `${completedBlocks}/${heights.length}`,
          resolved: done.length,
          unresolved: unresolved.length,
          failed_blocks: failures.length,
        }),
      );
    }
    await delay(PAUSE_MS);
  }
}

await Promise.all(Array.from({ length: Math.max(1, BLOCK_CONCURRENCY) }, () => worker()));

writeFileSync(OUT_PATH, JSON.stringify(done, null, 1));
console.log(
  JSON.stringify({
    event: "complete",
    requested: rows.length,
    resolved: done.length,
    unresolved: unresolved.length,
    unresolved_sample: unresolved.slice(0, 5),
    failed_blocks: failures.length,
    failures: failures.slice(0, 5),
  }),
);
