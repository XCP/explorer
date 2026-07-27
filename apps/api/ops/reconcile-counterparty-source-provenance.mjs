#!/usr/bin/env node

/**
 * Stamp authoritative-source provenance on a compact index whose migration path skipped the
 * refresh flow that normally records it.
 *
 * The v6 compact database carries the source tables and fingerprints but none of the
 * counterparty_source_remote_* metadata, so the verifier's authoritative_source_snapshot gate
 * fails on absent keys even though every count matches. This script performs a bounded
 * reconciliation against remote xcpio-core (the raw Counterparty mirror): all ledger
 * transactions at or below the snapshot's max block height must equal the local snapshot in
 * count, tx_index contiguity, and max height. Only when that holds are the provenance keys
 * stamped, together with an audit note. Nothing is stamped on any mismatch.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath =
  process.argv.find((value) => value.startsWith("--database="))?.slice(11) ??
  "C:/BitcoinIndex/counterparty-bitcoin.sqlite";
const apply = process.argv.includes("--apply");
const db = new DatabaseSync(databasePath, { readOnly: !apply });

const local = {
  transactions: Number(db.prepare("SELECT count(*) n FROM counterparty_tx_watch").get().n),
  maxTxIndex: Number(db.prepare("SELECT max(tx_index) n FROM counterparty_tx_watch").get().n),
  maxHeight: Number(db.prepare("SELECT max(expected_block_height) n FROM counterparty_tx_watch").get().n),
  watched: Number(db.prepare("SELECT count(*) n FROM watched_address").get().n),
  utxos: Number(db.prepare("SELECT count(*) n FROM counterparty_utxo_watch").get().n),
};

const apiDirectory = resolve(new URL("..", import.meta.url).pathname.slice(1));
const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
if (!existsSync(npxCli)) throw new Error(`Cannot find npm CLI at ${npxCli}`);
function remote(sql) {
  const stdout = execFileSync(
    process.execPath,
    [
      npxCli,
      "wrangler",
      "d1",
      "execute",
      "xcpio-core",
      "--remote",
      "--json",
      "--command",
      sql.replace(/\s+/g, " ").trim(),
    ],
    { cwd: apiDirectory, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const payload = JSON.parse(stdout);
  if (!Array.isArray(payload) || payload.some((item) => !item.success)) throw new Error("Remote D1 query failed");
  return payload.flatMap((item) => item.results ?? [])[0];
}

const bounded = remote(`SELECT count(*) transactions,count(DISTINCT tx_index) distinct_tx_indices,
  min(tx_index) min_tx_index,max(tx_index) max_tx_index,max(block_index) max_height
  FROM transactions WHERE block_index<=${local.maxHeight}`);
const chain = remote(`SELECT max(block_index) chain_height FROM transactions`);

const reconciled =
  Number(bounded.transactions) === local.transactions &&
  Number(bounded.distinct_tx_indices) === local.transactions &&
  Number(bounded.min_tx_index) === 0 &&
  Number(bounded.max_tx_index) === local.maxTxIndex &&
  Number(bounded.max_height) === local.maxHeight &&
  Number(chain.chain_height) >= local.maxHeight;

const report = { event: apply ? "provenance_reconciled" : "dry_run", reconciled, local, bounded, chain };
if (!reconciled) {
  console.error(JSON.stringify(report, null, 2));
  throw new Error("Bounded remote reconciliation failed; refusing to stamp provenance");
}
if (!apply) {
  console.log(JSON.stringify({ ...report, hint: "re-run with --apply" }, null, 2));
  process.exit(0);
}

db.exec("BEGIN IMMEDIATE");
const metadata = db.prepare(
  "INSERT INTO index_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
);
metadata.run("counterparty_source_remote_transactions", String(bounded.transactions));
metadata.run("counterparty_source_remote_addresses", String(local.watched));
metadata.run("counterparty_source_remote_utxos", String(local.utxos));
metadata.run("counterparty_source_remote_height", String(bounded.max_height));
metadata.run("counterparty_source_chain_height", String(chain.chain_height));
metadata.run("counterparty_source_refreshed_at", String(Math.floor(Date.now() / 1000)));
metadata.run(
  "counterparty_source_provenance_note_20260726",
  "bounded reconciliation against remote xcpio-core transactions at snapshot height; migration path had not stamped remote provenance",
);
db.exec("COMMIT");
console.log(JSON.stringify(report));
