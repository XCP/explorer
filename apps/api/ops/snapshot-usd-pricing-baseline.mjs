#!/usr/bin/env node

/** Freeze a production USD-pricing baseline for before/after policy evaluation. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const opsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(opsDirectory, "../../..");
const frozenAt = new Date().toISOString();
const day = frozenAt.slice(0, 10);
const output = resolve(process.env.BASELINE_OUTPUT || `${repositoryRoot}/docs/data/usd-pricing-baseline-${day}.json`);

function runJson(script) {
  return JSON.parse(
    execFileSync(process.execPath, [resolve(opsDirectory, script)], {
      cwd: resolve(repositoryRoot, "apps/api"),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
}

const audit = runJson("audit-usd-pricing.mjs");
const zaif = runJson("evaluate-zaif-xcp-history.mjs");
const frontier = executeRemoteD1(`SELECT key,value FROM core_state WHERE key IN (
  'last_event_index','last_block_index','last_block_hash','usd_cur','prices_cur_BTC','prices_cur_ETH'
) ORDER BY key`).rows;
const manifests = executeRemoteD1(`SELECT source,venue,dataset,source_url,sha256,fetched_at,rows
  FROM market_price_imports ORDER BY source,venue,dataset,source_url`).rows;

const manifestGroups = new Map();
for (const row of manifests) {
  const key = `${row.source}\u0000${row.venue}\u0000${row.dataset}`;
  const group = manifestGroups.get(key) ?? {
    source: row.source,
    venue: row.venue,
    dataset: row.dataset,
    files: 0,
    source_rows: 0,
    latest_fetch_at: 0,
    canonical_rows: [],
  };
  group.files += 1;
  group.source_rows += Number(row.rows);
  group.latest_fetch_at = Math.max(group.latest_fetch_at, Number(row.fetched_at));
  group.canonical_rows.push([row.source_url, row.sha256, Number(row.rows)]);
  manifestGroups.set(key, group);
}

const importManifests = [...manifestGroups.values()].map((group) => ({
  source: group.source,
  venue: group.venue,
  dataset: group.dataset,
  files: group.files,
  source_rows: group.source_rows,
  latest_fetch_at: group.latest_fetch_at,
  manifest_sha256: createHash("sha256").update(JSON.stringify(group.canonical_rows)).digest("hex"),
}));

const report = {
  schema: "xcp-usd-pricing-baseline/1",
  frozen_at: frozenAt,
  purpose: "Immutable before/after frontier for historical payment-value policy evaluation",
  contract: audit.contract,
  frontier: Object.fromEntries(frontier.map((row) => [row.key, row.value])),
  audit,
  corroboration: {
    provenance: zaif.provenance,
    xcp_btc: zaif.xcp_btc,
    xcp_jpy: zaif.xcp_jpy,
    combined: zaif.combined,
    xcp_btc_overlap: zaif.xcp_btc_overlap,
    usd: zaif.usd_corroboration,
  },
  import_manifests: importManifests,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ output, frozen_at: frozenAt, manifests: manifests.length }, null, 2)}\n`);
