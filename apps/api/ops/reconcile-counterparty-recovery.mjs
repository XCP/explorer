#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const HELP = `Usage: node apps/api/ops/reconcile-counterparty-recovery.mjs [options]

  --database=PATH          completed compact Bitcoin SQLite database
  --reference=PATH         SQLite snapshot of production recovery_outputs
  --proof=PATH             write successful reconciliation proof
  --refresh-reference      refresh verified reference rows from remote xcpio-btc
  --page-size=N            remote rows per request (default 10000)

Structural identity and missing verified outputs are strict. A remote spent output must have the same
local spend evidence. A remote recoverable output newly proven spent by local Core is reported as an
improvement rather than a contradiction.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const databasePath = resolve(option("database", "D:\\Bitcoin\\counterparty-index\\counterparty-bitcoin.sqlite"));
const referencePath = resolve(option("reference", "D:\\Bitcoin\\counterparty-index\\recovery-reference.sqlite"));
const proofPath = option("proof") ? resolve(option("proof")) : "";
const refreshReference = process.argv.includes("--refresh-reference");
const pageSize = Number.parseInt(option("page-size", "10000"), 10);
if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10_000) throw new Error("Invalid --page-size");

function remote(sql) {
  const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(npxCli)) throw new Error(`Cannot find npm CLI at ${npxCli}`);
  const command = sql.replace(/\s+/g, " ").trim();
  const stdout = execFileSync(
    process.execPath,
    [npxCli, "wrangler", "d1", "execute", "xcpio-btc", "--remote", "--json", "--command", command],
    {
      cwd: resolve(new URL("..", import.meta.url).pathname.slice(1)),
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  const payload = JSON.parse(stdout);
  if (!Array.isArray(payload) || payload.some((item) => !item.success)) throw new Error("Remote recovery query failed");
  return payload.flatMap((item) => item.results ?? []);
}

if (refreshReference) {
  mkdirSync(dirname(referencePath), { recursive: true });
  const reference = new DatabaseSync(referencePath);
  reference.exec(`
    CREATE TABLE IF NOT EXISTS recovery_outputs(
      txid TEXT NOT NULL,vout INTEGER NOT NULL,value_sats INTEGER NOT NULL,script_pubkey_hex TEXT NOT NULL,
      layout TEXT NOT NULL,recovery_key_hex TEXT,recovery_key_position INTEGER,recovery_address TEXT,
      classification TEXT NOT NULL,reason TEXT NOT NULL,block_height INTEGER,block_time INTEGER,
      spent_by_txid TEXT,spent_height INTEGER,classifier_version INTEGER NOT NULL,
      PRIMARY KEY(txid,vout)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS snapshot_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;
  `);
  reference.exec("DELETE FROM recovery_outputs");
  const insert = reference.prepare(`INSERT OR REPLACE INTO recovery_outputs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let cursorTxid = "";
  let cursorVout = -1;
  let fetched = 0;
  while (true) {
    const escaped = cursorTxid.replaceAll("'", "''");
    const rows = remote(`SELECT txid,vout,value_sats,script_pubkey_hex,layout,recovery_key_hex,
      recovery_key_position,recovery_address,classification,reason,block_height,block_time,
      spent_by_txid,spent_height,classifier_version FROM recovery_outputs
      WHERE classification IN ('recoverable','spent') AND
        (txid>'${escaped}' OR (txid='${escaped}' AND vout>${cursorVout}))
      ORDER BY txid,vout LIMIT ${pageSize}`);
    if (rows.length === 0) break;
    reference.exec("BEGIN");
    for (const row of rows)
      insert.run(
        row.txid,
        row.vout,
        row.value_sats,
        row.script_pubkey_hex,
        row.layout,
        row.recovery_key_hex,
        row.recovery_key_position,
        row.recovery_address,
        row.classification,
        row.reason,
        row.block_height,
        row.block_time,
        row.spent_by_txid,
        row.spent_height,
        row.classifier_version,
      );
    reference.exec("COMMIT");
    fetched += rows.length;
    cursorTxid = rows.at(-1).txid;
    cursorVout = Number(rows.at(-1).vout);
    if (rows.length < pageSize) break;
  }
  const remoteCount = Number(
    remote(`SELECT count(*) outputs FROM recovery_outputs WHERE classification IN ('recoverable','spent')`)[0].outputs,
  );
  const localCount = Number(reference.prepare("SELECT count(*) n FROM recovery_outputs").get().n);
  if (localCount !== remoteCount) {
    reference.close();
    throw new Error(`Recovery snapshot count mismatch: local ${localCount}, remote ${remoteCount}`);
  }
  const metadata = reference.prepare(`INSERT INTO snapshot_metadata(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  metadata.run("refreshed_at", String(Math.floor(Date.now() / 1000)));
  metadata.run("verified_outputs", String(remoteCount));
  metadata.run("fetched_this_run", String(fetched));
  reference.close();
}

if (!existsSync(databasePath)) throw new Error(`Missing compact database ${databasePath}`);
if (!existsSync(referencePath)) throw new Error(`Missing recovery reference ${referencePath}`);
const db = new DatabaseSync(databasePath, { readOnly: false });
db.exec("PRAGMA query_only=OFF");
db.exec(`ATTACH DATABASE '${referencePath.replaceAll("'", "''")}' AS reference`);
const scan = db
  .prepare("SELECT block_height,lower(hex(block_hash)) block_hash,policy_version FROM scan_state WHERE singleton=1")
  .get();
if (!scan) throw new Error("Compact scan has no checkpoint");
const referenceSummary = db
  .prepare(
    `SELECT count(*) outputs,count(DISTINCT txid) transactions,
  min(block_height) min_height,max(block_height) max_height FROM reference.recovery_outputs`,
  )
  .get();
const overlapHeight = Math.min(Number(scan.block_height), Number(referenceSummary.max_height));

const counts = db
  .prepare(
    `WITH local AS (
    SELECT lower(hex(tx_hash)) txid,vout,value_sats,script_pubkey_hex,layout,recovery_key_hex,
      recovery_key_position,recovery_address,classification,reason,block_height,block_time,
      lower(hex(spent_by_tx_hash)) spent_by_txid,spent_height,classifier_version
    FROM btc_recovery_output WHERE classification IN ('recoverable','spent') AND block_height<=?1
  ), remote AS (
    SELECT * FROM reference.recovery_outputs WHERE block_height<=?1
  )
  SELECT
    (SELECT count(*) FROM remote) expected,
    (SELECT count(*) FROM local) actual,
    (SELECT count(*) FROM remote r LEFT JOIN local l USING(txid,vout) WHERE l.txid IS NULL) missing,
    (SELECT count(*) FROM local l LEFT JOIN remote r USING(txid,vout) WHERE r.txid IS NULL) unexpected,
    (SELECT count(*) FROM remote r JOIN local l USING(txid,vout) WHERE
      r.value_sats IS NOT l.value_sats OR lower(r.script_pubkey_hex) IS NOT lower(l.script_pubkey_hex) OR
      r.layout IS NOT l.layout OR lower(r.recovery_key_hex) IS NOT lower(l.recovery_key_hex) OR
      r.recovery_key_position IS NOT l.recovery_key_position OR r.recovery_address IS NOT l.recovery_address OR
      r.block_height IS NOT l.block_height OR r.block_time IS NOT l.block_time OR
      r.classifier_version IS NOT l.classifier_version) structural_mismatches,
    (SELECT count(*) FROM remote r JOIN local l USING(txid,vout) WHERE r.classification='spent' AND
      (l.classification<>'spent' OR lower(r.spent_by_txid) IS NOT lower(l.spent_by_txid) OR
       r.spent_height IS NOT l.spent_height)) contradicted_remote_spends,
    (SELECT count(*) FROM remote r JOIN local l USING(txid,vout) WHERE
      r.classification='recoverable' AND l.classification='spent') newly_proven_spends
`,
  )
  .get(overlapHeight);

const strictFailures =
  Number(counts.missing) +
  Number(counts.unexpected) +
  Number(counts.structural_mismatches) +
  Number(counts.contradicted_remote_spends);
const result = {
  schema: "xcp-recovery-reconciliation-v1",
  verified_at: Math.floor(Date.now() / 1000),
  passed: strictFailures === 0,
  compact: { database: databasePath, scan },
  reference: { database: referencePath, ...referenceSummary },
  overlap_height: overlapHeight,
  counts,
  interpretation: {
    strict_failures: strictFailures,
    newly_proven_spends: "local Core evidence supersedes a stale remote recoverable state and is not a failure",
    unverified_structural_candidates: "outside this comparison by design",
  },
};
db.exec("DETACH DATABASE reference");
db.close();
const serialized = `${JSON.stringify(result, null, 2)}\n`;
console.log(serialized.trimEnd());
if (proofPath && result.passed) writeFileSync(proofPath, serialized, "utf8");
if (!result.passed) process.exitCode = 1;
