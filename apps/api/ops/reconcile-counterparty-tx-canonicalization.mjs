#!/usr/bin/env node

/**
 * Reconcile the compact index after malleated Counterparty transaction hashes were canonicalized.
 *
 * The 2026-07-26 canonicalization rewrote 1,141 counterparty_tx_watch hashes in place (same
 * tx_index and expected height, wtxid/malleated form replaced by the canonical txid). Two
 * consequences require repair before certification:
 *
 * 1. Transactions the scanner had already retained for their watched I/O — under the canonical
 *    txid — never received the Counterparty flag, because the watch table held the old hash when
 *    their block was scanned. Every watch member's btc_tx row must carry flag bit 2.
 * 2. The stored counterparty_source fingerprint predates the rewrite. It is restamped with the
 *    recomputed value, and the superseded sha plus the reason are preserved in index_metadata so
 *    the change stays auditable instead of looking like silent source drift.
 *
 * Run refresh-counterparty-bitcoin-metrics.mjs afterwards: per-block Counterparty transaction
 * counts are derived from btc_tx flags and must absorb the newly flagged rows.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const databasePath =
  process.argv.find((value) => value.startsWith("--database="))?.slice(11) ??
  "C:/BitcoinIndex/counterparty-bitcoin.sqlite";
const apply = process.argv.includes("--apply");
const db = new DatabaseSync(databasePath, { readOnly: !apply });

const unflagged = db
  .prepare(
    `SELECT tx.tx_id,lower(hex(tx.tx_hash)) tx_hash,tx.block_height,tx.flags
     FROM counterparty_tx_watch watch JOIN btc_tx tx ON tx.tx_hash=watch.tx_hash
     WHERE (tx.flags&2)=0 ORDER BY tx.block_height`,
  )
  .all();

function counterpartySourceFingerprint() {
  const hash = createHash("sha256");
  let count = 0;
  for (const row of db
    .prepare(
      "SELECT lower(hex(tx_hash)) tx_hash,tx_index,expected_block_height FROM counterparty_tx_watch ORDER BY tx_hash",
    )
    .iterate()) {
    hash.update(`${row.tx_hash}\0${row.tx_index ?? "null"}\0${row.expected_block_height ?? "null"}\n`);
    count += 1;
  }
  return { count, sha256: hash.digest("hex") };
}

const stored = {
  sha256: db.prepare("SELECT value FROM index_metadata WHERE key='counterparty_source_sha256'").get()?.value ?? null,
  count: db.prepare("SELECT value FROM index_metadata WHERE key='counterparty_source_count'").get()?.value ?? null,
};
const recomputed = counterpartySourceFingerprint();
if (Number(stored.count) !== recomputed.count) {
  throw new Error(
    `Watch count changed (${stored.count} -> ${recomputed.count}); this is not a hash-only canonicalization`,
  );
}

if (!apply) {
  console.log(
    JSON.stringify(
      { event: "dry_run", unflagged: unflagged.length, stored, recomputed, hint: "re-run with --apply" },
      null,
      2,
    ),
  );
  process.exit(0);
}

db.exec("BEGIN IMMEDIATE");
const flag = db.prepare("UPDATE btc_tx SET flags=flags|2 WHERE tx_id=?");
for (const row of unflagged) {
  flag.run(row.tx_id);
  console.log(JSON.stringify({ event: "counterparty_flag_repaired", ...row }));
}
const metadata = db.prepare(
  "INSERT INTO index_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
);
if (stored.sha256 && stored.sha256 !== recomputed.sha256) {
  metadata.run("counterparty_source_sha256_superseded_20260726", stored.sha256);
  metadata.run(
    "counterparty_source_restamp_reason_20260726",
    "1,141 malleated watch hashes canonicalized in place to txids (tx_index and heights unchanged)",
  );
  metadata.run("counterparty_source_sha256", recomputed.sha256);
}
db.exec("COMMIT");
console.log(
  JSON.stringify({
    event: "canonicalization_reconciled",
    flagged: unflagged.length,
    fingerprint_restamped: stored.sha256 !== recomputed.sha256,
    superseded_sha256: stored.sha256,
    counterparty_source_sha256: recomputed.sha256,
  }),
);
