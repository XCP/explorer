#!/usr/bin/env node
/** Apply a bounded, independently verified address receipt. Dry-run by default.
 * node ops/repair-audited-balances.mjs outputs/balance-integrity/ADDRESS.json [--apply]
 * Uses Wrangler's atomic SQL-file import, not a public admin HTTP endpoint. */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { balanceRepairStatements } from "#api/queries/balance-repair";
import { parseCounterpartyJson, balanceQuantity } from "#api/indexer/codec";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const [file, mode] = process.argv.slice(2);
if (!file || (mode && mode !== "--apply")) throw new Error("Supply one audit receipt and optional --apply");
const receipt = JSON.parse(readFileSync(file, "utf8"));
if (!/^[a-zA-Z0-9]{26,90}$/.test(receipt.address) || receipt.historyDifferences.length)
  throw new Error("Unverified receipt");
if (!receipt.differences.length) throw new Error("No repair needed");
const totals = new Map();
for (const [rows, direction] of [
  [receipt.credits, 1n],
  [receipt.debits, -1n],
]) {
  for (const row of rows) {
    if (!row.utxo && row.address === receipt.address) {
      totals.set(row.asset, (totals.get(row.asset) ?? 0n) + direction * balanceQuantity(row.quantity));
    }
  }
}
const balances = receipt.differences.map((change) => {
  const row = receipt.balances.find((row) => row.balance_id === change.balance_id && row.asset === change.asset);
  if (!row || row.quantity !== change.stored || (totals.get(change.asset) ?? 0n).toString() !== change.expected) {
    throw new Error("Repair disagrees with audit history");
  }
  return {
    balanceId: row.balance_id,
    address: receipt.address,
    asset: row.asset,
    previous: row.quantity,
    expected: change.expected,
    eventIndex: row.updated_event_index,
    divisible: row.divisible === 1,
  };
});
const snapshots = receipt.snapshotDifferences.map((change) => {
  const expected = receipt.ledger
    .filter((row) => row.asset === change.asset && row.event_index <= change.updated_event_index)
    .reduce((value, row) => value + (row.direction === 1 ? 1n : -1n) * balanceQuantity(row.quantity), 0n)
    .toString();
  if (expected !== change.expected) throw new Error("Snapshot disagrees with audit history");
  return {
    snapshotId: change.snapshot_id,
    address: receipt.address,
    asset: change.asset,
    previous: change.quantity,
    expected,
    eventIndex: change.updated_event_index,
  };
});
console.log(
  JSON.stringify({
    address: receipt.address,
    balances: balances.length,
    snapshots: snapshots.length,
    apply: mode === "--apply",
  }),
);
if (mode !== "--apply") process.exit(0);

// A current independent balance read must still agree before taking the lock.
// Fetch each changed asset, paced to avoid public API bursts; these receipts are small.
for (const row of balances) {
  const response = await fetch(
    `https://api.counterparty.io:4000/v2/addresses/${receipt.address}/balances/${row.asset}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`Core ${response.status}; abort without database writes`);
  const data = parseCounterpartyJson(await response.text());
  if (data.error || !Array.isArray(data.result)) throw new Error("Unexpected Core asset balance shape");
  const relevant = data.result.filter(
    (value) => !value.utxo && value.address === receipt.address && value.asset === row.asset,
  );
  const current = relevant.reduce((value, item) => value + balanceQuantity(item.quantity), 0n);
  if (current.toString() !== row.expected) throw new Error(`Core balance changed: ${row.asset}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
const capture = {
  prepare(sql) {
    return {
      bind(...binds) {
        let offset = 0;
        return sql.replace(/\?/g, () => {
          const value = binds[offset++];
          if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
          if (Number.isSafeInteger(value)) return String(value);
          throw new Error("Unsafe SQL repair binding");
        });
      },
    };
  },
};
const lock = String(Math.floor(Date.now() / 1000));
const checkpointResponse = await fetch(
  `https://api.counterparty.io:4000/v2/blocks/${receipt.checkpoint.last_block_index}`,
);
if (!checkpointResponse.ok) throw new Error(`Core checkpoint ${checkpointResponse.status}`);
const checkpoint = parseCounterpartyJson(await checkpointResponse.text());
if (checkpoint.result?.block_hash !== receipt.checkpoint.last_block_hash) throw new Error("Audited chain changed");
const state = executeRemoteD1("SELECT value FROM core_state WHERE key='last_event_index'").rows[0];
const statements = [
  capture
    .prepare(
      `INSERT INTO core_state(key,value) VALUES('replay_lock',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<?`,
    )
    .bind(lock, Number(lock) - 900),
  capture
    .prepare(
      `SELECT CASE WHEN (SELECT lower(hex(block_hash)) FROM blocks WHERE block_index=?)=?
    THEN 1 ELSE json('audit checkpoint changed') END verified`,
    )
    .bind(Number(receipt.checkpoint.last_block_index), receipt.checkpoint.last_block_hash),
  ...balanceRepairStatements(capture, lock, state.value, balances, snapshots),
  capture.prepare("DELETE FROM core_state WHERE key='replay_lock' AND value=?").bind(lock),
];
const sqlFile = `${file}.repair.sql`;
writeFileSync(sqlFile, statements.join(";\n") + ";\n");
// Wrangler's SQL-file import is atomic: a failing assertion restores the
// original database. It briefly blocks queries, unlike a long history rebuild.
const wrangler = fileURLToPath(new URL("../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const result = spawnSync(
  process.execPath,
  [wrangler, "d1", "execute", "xcpio-core", "--remote", "--file", sqlFile, "--yes"],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);
writeFileSync(
  `${file}.applied.json`,
  JSON.stringify(
    {
      appliedAt: new Date().toISOString(),
      cursor: state.value,
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    },
    null,
    2,
  ),
);
console.log(result.stdout);
if (result.status !== 0) throw new Error(result.stderr || "Atomic repair import failed");
