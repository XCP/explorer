#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { base58 } from "@scure/base";

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const HELP = `Usage: node apps/api/ops/verify-electrs-index.mjs [options]

  --host=HOST              Electrum TCP host (default 127.0.0.1)
  --port=N                 Electrum TCP port (default 50001)
  --address=ADDRESS        known historical P2PKH address
  --datadir=PATH           Bitcoin Core datadir (default C:\\BitcoinFastState)
  --cookie=PATH            override Core RPC cookie
  --rpc-url=URL            Core JSON-RPC URL
  --proof=PATH             durable JSON proof destination
  --max-tip-lag=N          allowed Electrs lag behind Core (default 1)
  --minimum-height=N       authoritative source floor (default 958766)
  --max-tip-age=N          maximum Core tip age in seconds (default 86400)`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const host = option("host", "127.0.0.1");
const port = Number.parseInt(option("port", "50001"), 10);
const address = option("address", "16CKKa28a3B2fBJF9ZvXY5MTpzY41TmVrG");
const datadir = resolve(option("datadir", "C:\\BitcoinFastState"));
const cookie = resolve(option("cookie", resolve(datadir, ".cookie")));
const rpcUrl = option("rpc-url", "http://127.0.0.1:8332/");
const proofPath = resolve(option("proof", "D:\\Bitcoin\\counterparty-index\\electrs-index-proof.json"));
const maxTipLag = Number.parseInt(option("max-tip-lag", "1"), 10);
const minimumHeight = Number.parseInt(option("minimum-height", "958766"), 10);
const maxTipAge = Number.parseInt(option("max-tip-age", "86400"), 10);

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port");
if (!Number.isSafeInteger(maxTipLag) || maxTipLag < 0) throw new Error("Invalid --max-tip-lag");
if (!Number.isSafeInteger(minimumHeight) || minimumHeight < 0) throw new Error("Invalid --minimum-height");
if (!Number.isSafeInteger(maxTipAge) || maxTipAge < 1) throw new Error("Invalid --max-tip-age");

let electrumId = 0;
function electrum(method, params = []) {
  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(15_000);
    let received = "";
    const id = ++electrumId;
    socket.on("connect", () => socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`));
    socket.on("data", (chunk) => {
      received += chunk.toString("utf8");
      const newline = received.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        const response = JSON.parse(received.slice(0, newline));
        if (response.error) reject(new Error(`${method}: ${JSON.stringify(response.error)}`));
        else resolvePromise(response.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("timeout", () => socket.destroy(new Error(`${method}: timeout`)));
    socket.on("error", reject);
  });
}

const authorization = `Basic ${Buffer.from(readFileSync(cookie, "utf8").trim()).toString("base64")}`;
let rpcId = 0;
async function core(method, params = []) {
  const id = ++rpcId;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!response.ok) throw new Error(`Core HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.code} ${payload.error.message}`);
  return payload.result;
}

function p2pkhScripthash(value) {
  const decoded = base58.decode(value);
  if (decoded.length !== 25 || decoded[0] !== 0) throw new Error("Verification address must be mainnet P2PKH");
  const body = decoded.subarray(0, 21);
  const checksum = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!Buffer.from(checksum).equals(Buffer.from(decoded.subarray(21)))) throw new Error("Address checksum mismatch");
  const script = Buffer.concat([
    Buffer.from("76a914", "hex"),
    Buffer.from(decoded.subarray(1, 21)),
    Buffer.from("88ac", "hex"),
  ]);
  return createHash("sha256").update(script).digest().reverse().toString("hex");
}

const chain = await core("getblockchaininfo");
if (chain.initialblockdownload || chain.blocks !== chain.headers) throw new Error("Core is not fully synchronized");
const tipAgeSeconds = Math.floor(Date.now() / 1000) - Number(chain.time);
if (chain.blocks < minimumHeight) throw new Error(`Core height ${chain.blocks} is below source floor ${minimumHeight}`);
if (tipAgeSeconds < 0 || tipAgeSeconds > maxTipAge)
  throw new Error(`Core tip age ${tipAgeSeconds}s exceeds ${maxTipAge}s`);
const serverVersion = await electrum("server.version", ["xcp-explorer-verifier", "1.4"]);
const tip = await electrum("blockchain.headers.subscribe");
const electrsHeight = Number(tip.height);
if (!Number.isSafeInteger(electrsHeight) || electrsHeight < chain.blocks - maxTipLag || electrsHeight > chain.blocks) {
  throw new Error(`Electrs height ${electrsHeight} does not reconcile with Core ${chain.blocks}`);
}

const scriptHash = p2pkhScripthash(address);
const history = await electrum("blockchain.scripthash.get_history", [scriptHash]);
if (!Array.isArray(history) || history.length === 0) throw new Error(`No historical Electrs activity for ${address}`);
const confirmed = history.filter((item) => Number(item.height) > 0);
if (confirmed.length === 0) throw new Error(`No confirmed Electrs activity for ${address}`);

const reconciled = [];
for (const item of confirmed.slice(0, 20)) {
  const transaction = await core("getrawtransaction", [item.tx_hash, true]);
  if (transaction.txid !== item.tx_hash || typeof transaction.blockhash !== "string") {
    throw new Error(`Core transaction mismatch for ${item.tx_hash}`);
  }
  const header = await core("getblockheader", [transaction.blockhash, true]);
  if (Number(header.height) !== Number(item.height)) {
    throw new Error(`Electrs/Core height mismatch for ${item.tx_hash}`);
  }
  reconciled.push({ txid: item.tx_hash, height: Number(item.height), block_hash: transaction.blockhash });
}

const proof = {
  schema: "xcp-electrs-index-proof-v1",
  verified_at: Math.floor(Date.now() / 1000),
  server_version: serverVersion,
  core_height: Number(chain.blocks),
  core_best_block_hash: chain.bestblockhash,
  core_best_block_time: Number(chain.time),
  core_tip_age_seconds: tipAgeSeconds,
  minimum_height: minimumHeight,
  electrs_height: electrsHeight,
  address,
  script_hash: scriptHash,
  history_count: history.length,
  confirmed_count: confirmed.length,
  first_confirmed_height: Math.min(...confirmed.map((item) => Number(item.height))),
  last_confirmed_height: Math.max(...confirmed.map((item) => Number(item.height))),
  reconciled,
};
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify(proof, null, 2));
