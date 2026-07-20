#!/usr/bin/env node

/** Build a resumable, cutoff-safe local address evaluation artifact from bounded D1 queries. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { CUTOFFS, HORIZON_DAYS } from "./evaluate-reputation-baselines.mjs";
import { evaluateAddressSnapshot, sha256, snapshotManifest } from "./lib/reputation-snapshot.mjs";

const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const cutoffLabel = arg("cutoff", CUTOFFS.at(-1)[0]);
const cutoffEntry = CUTOFFS.find(([label]) => label === cutoffLabel);
if (!cutoffEntry) throw new Error(`Unknown cutoff: ${cutoffLabel}`);
const cutoff = Number(cutoffEntry[1]);
const outcomeEnd = cutoff + HORIZON_DAYS * 86400;
const chunkSize = Number(arg("chunk-size", "10000"));
if (!Number.isInteger(chunkSize) || chunkSize < 100 || chunkSize > 10000)
  throw new Error("chunk-size must be 100..10000");
const root = resolve(arg("output", join(".analytics", "reputation", "addresses", cutoffLabel)));
mkdirSync(root, { recursive: true });

const state = executeRemoteD1(
  `SELECT COALESCE(MAX(source_id),0) max_id,COUNT(*) transactions FROM transactions
   WHERE source_id IS NOT NULL AND supported=1 AND block_time>0 AND block_time<=${outcomeEnd};`,
);
const maxId = Number(state.rows[0]?.max_id ?? 0);
const buildPath = join(root, "build.json");
let build;
try {
  build = JSON.parse(readFileSync(buildPath, "utf8"));
} catch {
  let priorManifest = null;
  try {
    priorManifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  } catch {}
  build = {
    schema: "xcp-reputation-snapshot-build/1",
    cutoff: cutoffLabel,
    horizon_days: HORIZON_DAYS,
    canonical_frontier:
      priorManifest?.canonical_frontier ??
      executeRemoteD1(`SELECT value FROM core_state WHERE key='last_event_index'`).rows[0]?.value ??
      null,
  };
  writeFileSync(buildPath, `${JSON.stringify(build, null, 2)}\n`);
}
if (build.cutoff !== cutoffLabel || Number(build.horizon_days) !== HORIZON_DAYS)
  throw new Error("Snapshot build receipt does not match requested cutoff/horizon");
const chunks = [];
const allRows = [];
for (let start = 0; start <= maxId; start += chunkSize) {
  const end = start + chunkSize;
  const name = `${String(start).padStart(8, "0")}.ndjson`;
  const path = join(root, name);
  let body;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    const result = executeRemoteD1(`SELECT source_id id,
      SUM(block_time<=${cutoff}) past_transactions,
      COUNT(DISTINCT CASE WHEN block_time<=${cutoff} THEN strftime('%Y-%m',block_time,'unixepoch') END)
        past_active_months,
      MAX(CASE WHEN block_time<=${cutoff} THEN block_time END) last_transaction_time,
      SUM(block_time>${cutoff} AND block_time<=${outcomeEnd}) future_transactions,
      COUNT(DISTINCT CASE WHEN block_time>${cutoff} AND block_time<=${outcomeEnd}
        THEN strftime('%Y-%m',block_time,'unixepoch') END) future_active_months
    FROM transactions INDEXED BY idx_transactions_source
    WHERE source_id>=${start} AND source_id<${end} AND supported=1 AND block_time>0 AND block_time<=${outcomeEnd}
    GROUP BY source_id HAVING past_transactions>0 ORDER BY source_id`);
    body = result.rows.map((row) => JSON.stringify(row)).join("\n");
    if (body) body += "\n";
    writeFileSync(path, body);
  }
  const rows = body.trim() ? body.trim().split("\n").map(JSON.parse) : [];
  allRows.push(...rows);
  chunks.push({ name, rows: rows.length, sha256: sha256(body) });
}

const manifest = snapshotManifest({
  cutoff: cutoffLabel,
  horizonDays: HORIZON_DAYS,
  frontier: build.canonical_frontier,
  chunks,
  rows: allRows.length,
});
writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(root, "evaluation.json"), `${JSON.stringify(evaluateAddressSnapshot(allRows), null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ root, manifest, evaluation: evaluateAddressSnapshot(allRows) }, null, 2)}\n`);
