#!/usr/bin/env node

/** Export the published graph in resumable pages and evaluate deterministic held-out seeds offline. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { evaluateHeldoutGraph } from "./lib/graph-heldout.mjs";
import { sha256, snapshotManifest } from "./lib/reputation-snapshot.mjs";

const PAGE_SIZE = 10_000;
const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const state = executeRemoteD1(
  `SELECT CAST((SELECT value FROM core_state WHERE key='graph_generation') AS INTEGER) generation,
    COALESCE((SELECT MAX(block_index) FROM blocks),0) tip`,
).rows[0];
const generation = Number(state.generation);
const tip = Number(state.tip);
const holdoutFold = Number(arg("fold", "0"));
if (!Number.isInteger(holdoutFold) || holdoutFold < 0 || holdoutFold > 4) throw new Error("fold must be 0..4");
const root = resolve(arg("output", join(".analytics", "reputation", "graph", `generation-${generation}`)));
mkdirSync(root, { recursive: true });
const buildPath = join(root, "build.json");
let build;
try {
  build = JSON.parse(readFileSync(buildPath, "utf8"));
} catch {
  build = { schema: "xcp-graph-evaluation-build/1", generation, tip };
  writeFileSync(buildPath, `${JSON.stringify(build, null, 2)}\n`);
}
if (build.generation !== generation) throw new Error("Published graph generation changed; use a new output directory");

const chunks = [];
const edges = [];
let source = -1;
let destination = -1;
for (let page = 0; ; page++) {
  const name = `${String(page).padStart(5, "0")}.ndjson`;
  const path = join(root, name);
  let body;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    const result = executeRemoteD1(
      `SELECT source_entity_id source,destination_entity_id destination,weight,edge_block
       FROM graph_edges WHERE generation=${generation}
         AND (source_entity_id>${source} OR (source_entity_id=${source} AND destination_entity_id>${destination}))
       ORDER BY source_entity_id,destination_entity_id LIMIT ${PAGE_SIZE}`,
    );
    body = result.rows.map((row) => JSON.stringify(row)).join("\n");
    if (body) body += "\n";
    writeFileSync(path, body);
  }
  const rows = body.trim() ? body.trim().split("\n").map(JSON.parse) : [];
  edges.push(...rows);
  chunks.push({ name, rows: rows.length, sha256: sha256(body) });
  if (rows.length < PAGE_SIZE) break;
  source = Number(rows.at(-1).source);
  destination = Number(rows.at(-1).destination);
}

const seedResult = executeRemoteD1(
  `SELECT seed.entity_id,entity.entity_type,entity.entity_key key,seed.slot
   FROM graph_seed seed JOIN entity_dictionary entity ON entity.entity_id=seed.entity_id
   WHERE seed.generation=${generation} ORDER BY seed.slot,seed.entity_id LIMIT 10000`,
);
if (seedResult.rows.length >= 10_000) throw new Error("Graph seed export reached its safety limit");
const seeds = seedResult.rows.map((row) => ({ ...row, entity_id: Number(row.entity_id), slot: Number(row.slot) }));
const maxNode = edges.reduce((max, edge) => Math.max(max, Number(edge.source), Number(edge.destination)), 0);
const manifest = snapshotManifest({
  cutoff: `graph-generation-${generation}`,
  horizonDays: 0,
  frontier: String(build.tip),
  chunks,
  rows: edges.length,
});
const report = {
  schema: "xcp-graph-heldout-evaluation/1",
  generation,
  tip: build.tip,
  manifest,
  seeds: seeds.length,
  methodology: {
    holdout: "deterministic 20% of each source label; held-out labels receive no teleport mass",
    flat: "production PPR math and published edge weights",
    temporal: "one-year half-life on transaction edges; current-state bipartite edges do not decay",
    warning: "seed-label recovery measures propagation, not general trustworthiness or precision over unlabeled nodes",
  },
  holdout_fold: holdoutFold,
  flat: evaluateHeldoutGraph({ edges, seeds, maxNode, tip: build.tip, holdoutFold }),
  temporal: evaluateHeldoutGraph({ edges, seeds, maxNode, tip: build.tip, halfLifeBlocks: 52_560, holdoutFold }),
};
writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(root, `evaluation-fold-${holdoutFold}.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ root, report }, null, 2)}\n`);
