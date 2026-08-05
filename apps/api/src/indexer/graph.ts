/**
 * Graph-reputation trait (Phase C) — builds a STANDALONE Min-k-PPR TrustRank + reverse-graph
 * Anti-TrustRank scorer over the money-flow graph, and writes graph_trust / graph_distrust onto the
 * signals tables. The Env-free math (edge SQL, the dense in-memory engine, k-split, tier) lives in
 * graph-core.ts so the validation harness can import it without the Worker Env. See
 * docs/graph-reputation.md for the basis.
 *
 * This does not enter Address Reputation, Asset Rating, or Conviction. It is served on its own as
 * trusted / distrusted / unscored relationship evidence and supports holder-cohesion analysis.
 *
 * PIPELINE (graph_edges -> in-memory power iteration -> signals):
 *   EDGES: address->address from sends (source->destination), order_matches (BOTH directions), dispenses
 *          (buyer->creator, origin-aware via COALESCE(dispensers.origin, dispenses.source)); PLUS bipartite
 *          holder<->asset and asset<->issuer (both directions). Weight = ln(1+count) for address pairs,
 *          ln(2) for bipartite edges. Curated exchanges + burns are conduits, not endorsers: every edge
 *          whose SOURCE is an exchange/burn is DROPPED. Edges persist in graph_edges (served by
 *          holder-cohesion and the graph-extract reads) and fully rebuild every ~8 weeks.
 *   SEEDS: trust = grail assets + their issuers + curated-collection cards + Established+ rated assets +
 *          archetype addresses; distrust = low-quality assets + issuers + derived scam actors. Staged in
 *          graph_seed (graph-eval joins it for the held-out split), split k=3 ways by seedSubset.
 *   SCORE: weekly, in ONE invocation — read the persisted edges into typed arrays, run the damped
 *          degree-normalized passes in Worker memory, and write back ONLY the signal rows whose quantized
 *          value moved. The retired SQL form of these passes billed ~200M D1 row writes per rebuild; the
 *          in-memory form bills the changed rows.
 */
import type { Env } from "#api/env";
import { q } from "#api/db";
import {
  K,
  DISTRUST_SLOT,
  seedSubset,
  ENTITY_IDENTITY_STATEMENTS,
  entityEdgeStatements,
  entitySeedInsertStatement,
  buildDenseGraph,
  computeGraphScores,
  quantizeGraphScore,
  graphPercentileCut,
  type DenseGraph,
  type GraphEdgeArrays,
  type GraphSeed,
} from "#api/indexer/graph-core";

const DEFAULT_WORK = 8; // build ops advanced per admin call

// core_state cursor keys
const K_PHASE = "graph_phase"; // "build" | "score" | "done"
const K_BUILD = "graph_build_i"; // cursor into the build-op list
const K_GENERATION = "graph_build_generation";
const K_SCORED_BLOCK = "graph_rebuilt_block"; // last completed score pass
const K_EDGES_BLOCK = "graph_edges_built_block"; // last completed full edge rebuild
const K_SCORE_LEASE = "graph_score_lease"; // unix seconds; guards the single-invocation score pass

const WEEK_BLOCKS = 1008; // ~7 days — the score cadence (seeds + ranks move weekly)
const EDGE_REBUILD_BLOCKS = 8064; // ~8 weeks — full edge refresh; the 12-year topology drifts slowly
const SCORE_LEASE_SECONDS = 600;

const getState = async (db: D1Database, key: string): Promise<string | null> =>
  (await db.prepare(`SELECT value FROM core_state WHERE key=?`).bind(key).first<{ value: string }>())?.value ?? null;
const setState = async (db: D1Database, key: string, value: string | number): Promise<void> => {
  await db
    .prepare(`INSERT INTO core_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .bind(key, String(value))
    .run();
};

const chunk = <T>(a: T[], n: number): T[][] => {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
};
const int = (v: string | null, d: number): number => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : d;
};

// ---------------------------------------------------------------------------------------------------
// SEEDS. Compute the trust/distrust node sets from curated + the mirror, split trust k ways, and stage
// them in graph_seed. Chunk sizes respect D1's 100-bound-parameters-per-query limit (20 rows x 4 vars).
// ---------------------------------------------------------------------------------------------------
async function distinctIssuers(env: Env, assets: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const part of chunk(assets, 90)) {
    if (!part.length) continue;
    const ph = part.map(() => "?").join(",");
    const r = await q<{ issuer: string }>(
      env.CORE_DB,
      `SELECT DISTINCT issuer.address issuer FROM assets state
       JOIN asset_dictionary asset ON asset.asset_id=state.asset_id
       JOIN address_dictionary issuer ON issuer.address_id=state.issuer_id
       WHERE asset.asset IN (${ph})`,
      ...part,
    );
    for (const x of r) if (x.issuer) out.add(x.issuer);
  }
  return [...out];
}

// Curated-collection membership = the hand-labelled legit ecosystem (non-circular: directory curation, not
// market stats). The "proven ecosystem citizen" ARCHETYPE tags (from the reputation thresholds, config.TAG)
// are our persisted trust label for PEOPLE — collector (held ≥100), creator (survived ≥20), etc. Graph trust
// feeds NEITHER the asset-quality nor the address-reputation score (H4), so seeding the graph from those is a
// high-precision starting point, not circular.
const COLLECTION_TAGS = [
  "rare-pepe",
  "fake-rare",
  "dank-rare",
  "spells-of-genesis",
  "bitcorn",
  "rare-coco",
  "notable-pepe",
  "the-wojak-way",
  "kaleidoscope",
];
const TRUST_ARCHETYPES = ["collector", "creator", "prolific_creator", "dividend_payer"];
// A scammer never seeds trust even if they also collect/create — bad wins here. (Infra already can't carry
// these tags, but we guard anyway.)
const NOT_INFRA_OR_SCAM = `sig.is_exchange=0 AND sig.is_burn=0 AND sig.is_deposit=0 AND sig.is_emblem_vault=0
  AND COALESCE(sig.shell_scams,0)=0 AND COALESCE(sig.vault_scams,0)=0`;

/**
 * Trust the ART by our QUALITY score, trust PEOPLE by our reputation ARCHETYPES — the trust signals we
 * already compute, not a flat cohort. Trust-asset seeds = curated grails + every curated-collection card +
 * algorithmically Established+ assets (the quality score's top tier). Trust-ADDRESS seeds = the good-actor
 * archetype tags, never infra or a scammer. Seeds are high-precision; the graph propagates from them.
 */
async function stageSeeds(env: Env, generation: number): Promise<void> {
  const tagPh = COLLECTION_TAGS.map(() => "?").join(",");
  const archPh = TRUST_ARCHETYPES.map(() => "?").join(",");
  const excluded = new Set(
    (await q<{ key: string }>(env.CORE_DB, `SELECT key FROM curated WHERE kind IN ('exchange','burn')`)).map(
      (r) => r.key,
    ),
  );
  // ---- TRUST ASSETS: grails + curated collections + Established+ by our QUALITY score ----
  const grails = (await q<{ key: string }>(env.CORE_DB, `SELECT key FROM curated WHERE kind='grail'`)).map(
    (r) => r.key,
  );
  const collAssets = (
    await q<{ a: string }>(
      env.CORE_DB,
      `SELECT DISTINCT entity.entity_key a FROM tags tag
       JOIN entity_dictionary entity ON entity.entity_id=tag.entity_id AND entity.entity_type='asset'
       WHERE tag.tag IN (${tagPh})`,
      ...COLLECTION_TAGS,
    )
  ).map((r) => r.a);
  const rated = (
    await q<{ a: string }>(
      env.CORE_DB,
      `SELECT asset.asset a FROM asset_ratings rating
       JOIN asset_dictionary asset ON asset.asset_id=rating.asset_id
       WHERE rating.rating>=7`,
    )
  ).map((r) => r.a);
  const trust = new Set<string>();
  for (const a of [...grails, ...collAssets, ...rated]) trust.add(`asset:${a}`);

  // ---- TRUST ADDRESSES: proven-ecosystem archetype tags, never infra/scam (+ grail issuers as axioms) ----
  const trustAddrs = (
    await q<{ address: string }>(
      env.CORE_DB,
      `SELECT DISTINCT entity.entity_key address FROM tags t
       JOIN entity_dictionary entity ON entity.entity_id=t.entity_id AND entity.entity_type='address'
       JOIN address_dictionary address ON address.address=entity.entity_key
       JOIN address_signals sig ON sig.address_id=address.address_id
       WHERE t.tag IN (${archPh}) AND ${NOT_INFRA_OR_SCAM}`,
      ...TRUST_ARCHETYPES,
    )
  ).map((r) => r.address);
  const grailIssuers = await distinctIssuers(env, grails); // a grail's creator is an axiom, even if under the creator threshold
  for (const address of [...trustAddrs, ...grailIssuers]) if (!excluded.has(address)) trust.add(address);

  // ---- DISTRUST: curated lowq + their issuers + derived scam actors ----
  const lowqs = (await q<{ key: string }>(env.CORE_DB, `SELECT key FROM curated WHERE kind='lowq'`)).map((r) => r.key);
  const distrust = new Set<string>();
  for (const l of lowqs) distrust.add(`asset:${l}`);
  for (const a of await distinctIssuers(env, lowqs)) if (!excluded.has(a)) distrust.add(a);
  const scamActors = (
    await q<{ address: string }>(
      env.CORE_DB,
      `SELECT address.address FROM address_signals signal
       JOIN address_dictionary address ON address.address_id=signal.address_id
       WHERE signal.shell_scams>0 OR signal.vault_scams>0 OR signal.dump_scams>0`,
    )
  ).map((r) => r.address);
  for (const a of scamActors) if (!excluded.has(a)) distrust.add(a);
  for (const n of trust) distrust.delete(n); // trust wins the (rare) collision to keep Σs=1 exact

  // ---- STAGE: split trust k ways (Min-k), distrust into its slot; batch the ~13k inserts ----
  const subsets: string[][] = Array.from({ length: K }, () => []);
  for (const key of trust) subsets[seedSubset(key)].push(key);
  const rows: [string, string, number, number][] = [];
  subsets.forEach((sub, slot) => {
    const s = sub.length ? 1 / sub.length : 0;
    for (const node of sub)
      rows.push([node.startsWith("asset:") ? "asset" : "address", node.replace(/^asset:/, ""), slot, s]);
  });
  const dArr = [...distrust];
  const ds = dArr.length ? 1 / dArr.length : 0;
  for (const node of dArr)
    rows.push([node.startsWith("asset:") ? "asset" : "address", node.replace(/^asset:/, ""), DISTRUST_SLOT, ds]);

  // Re-staged in place weekly: graph-eval reads graph_seed at the published generation.
  await env.CORE_DB.prepare(`DELETE FROM graph_seed WHERE generation=?`).bind(generation).run();
  const stmts = chunk(rows, 20)
    .filter((p) => p.length)
    .map((part) => env.CORE_DB.prepare(entitySeedInsertStatement(generation, part.length)).bind(...part.flat()));
  for (const b of chunk(stmts, 20)) await env.CORE_DB.batch(b);
}

// ---------------------------------------------------------------------------------------------------
// The score pass: persisted edges -> typed arrays -> in-memory iteration -> delta write-back.
// ---------------------------------------------------------------------------------------------------
const EDGE_PAGE = 50_000;
const SIGNAL_PAGE = 50_000;
const UPDATE_ROWS = 30; // 90 bound parameters per statement, under D1's 100-bind cap
const UPDATE_STATEMENTS_PER_BATCH = 40;

async function readEdges(env: Env, generation: number): Promise<GraphEdgeArrays> {
  const total =
    Number(
      (
        await env.CORE_DB.prepare(`SELECT COUNT(*) n FROM graph_edges WHERE generation=?`).bind(generation).first<{
          n: number;
        }>()
      )?.n,
    ) || 0;
  const edges: GraphEdgeArrays = {
    source: new Uint32Array(total),
    destination: new Uint32Array(total),
    weight: new Float64Array(total),
    edgeCount: 0,
  };
  let lastSource = -1;
  let lastDestination = -1;
  for (;;) {
    const page = await q<{ s: number; d: number; w: number }>(
      env.CORE_DB,
      `SELECT source_entity_id s,destination_entity_id d,weight w FROM graph_edges
       WHERE generation=?1 AND (source_entity_id>?2 OR (source_entity_id=?2 AND destination_entity_id>?3))
       ORDER BY source_entity_id,destination_entity_id LIMIT ${EDGE_PAGE}`,
      generation,
      lastSource,
      lastDestination,
    );
    for (const row of page) {
      if (edges.edgeCount >= total) break; // a concurrent insert grew the table mid-read; the extra edge waits a week
      edges.source[edges.edgeCount] = row.s;
      edges.destination[edges.edgeCount] = row.d;
      edges.weight[edges.edgeCount] = row.w;
      edges.edgeCount++;
    }
    if (page.length < EDGE_PAGE) break;
    lastSource = page[page.length - 1].s;
    lastDestination = page[page.length - 1].d;
  }
  return edges;
}

interface SignalPublication {
  updates: number;
  trustCut: number;
  distrustCut: number;
}

/** Diff one signals table against the freshly computed vectors and update only the rows that moved. */
async function publishSignalScores(
  env: Env,
  graph: DenseGraph,
  trust: Float64Array,
  distrust: Float64Array,
  side: "address" | "asset",
): Promise<SignalPublication> {
  const scoreOf = (entityId: number | null, vector: Float64Array): number => {
    if (entityId === null || entityId >= graph.denseOf.length) return 0;
    const dense = graph.denseOf[entityId];
    return dense < 0 ? 0 : quantizeGraphScore(vector[dense]);
  };
  const pageSql =
    side === "address"
      ? `SELECT entity.entity_id eid,signal.address_id tid,signal.graph_trust t,signal.graph_distrust d,0 lowq
         FROM address_signals signal
         JOIN address_dictionary address ON address.address_id=signal.address_id
         LEFT JOIN entity_dictionary entity ON entity.entity_type='address' AND entity.entity_key=address.address
         WHERE signal.address_id>? ORDER BY signal.address_id LIMIT ${SIGNAL_PAGE}`
      : `SELECT entity.entity_id eid,signal.asset_id tid,signal.graph_trust t,signal.graph_distrust d,
                COALESCE(signal.low_quality,0) lowq
         FROM asset_signals signal
         JOIN asset_dictionary asset ON asset.asset_id=signal.asset_id
         LEFT JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=asset.asset
         WHERE signal.asset_id>? ORDER BY signal.asset_id LIMIT ${SIGNAL_PAGE}`;
  const table = side === "address" ? "address_signals" : "asset_signals";
  const idColumn = side === "address" ? "address_id" : "asset_id";

  const changed: Array<[number, number, number]> = [];
  const positiveTrust: number[] = [];
  const positiveDistrust: number[] = [];
  let cursor = 0;
  for (;;) {
    const page = await q<{ eid: number | null; tid: number; t: number; d: number; lowq: number }>(
      env.CORE_DB,
      pageSql,
      cursor,
    );
    for (const row of page) {
      // Low-quality assets never carry trust, even when the walk reaches them.
      const newTrust = row.lowq === 1 ? 0 : scoreOf(row.eid, trust);
      const newDistrust = scoreOf(row.eid, distrust);
      if (newTrust > 0) positiveTrust.push(newTrust);
      if (newDistrust > 0) positiveDistrust.push(newDistrust);
      if (newTrust !== row.t || newDistrust !== row.d) changed.push([row.tid, newTrust, newDistrust]);
    }
    if (page.length < SIGNAL_PAGE) break;
    cursor = page[page.length - 1].tid;
  }

  const statements = chunk(changed, UPDATE_ROWS).map((part) =>
    env.CORE_DB.prepare(
      `UPDATE ${table} AS signal SET graph_trust=diff.column2,graph_distrust=diff.column3
       FROM (VALUES ${part.map(() => "(?,?,?)").join(",")}) diff WHERE signal.${idColumn}=diff.column1`,
    ).bind(...part.flat()),
  );
  for (const batch of chunk(statements, UPDATE_STATEMENTS_PER_BATCH)) await env.CORE_DB.batch(batch);

  return {
    updates: changed.length,
    trustCut: graphPercentileCut(positiveTrust, 0.9),
    distrustCut: graphPercentileCut(positiveDistrust, 0.98),
  };
}

interface ScoreSummary {
  nodes: number;
  edges: number;
  addressUpdates: number;
  assetUpdates: number;
}

async function runScorePass(env: Env, generation: number): Promise<ScoreSummary> {
  await stageSeeds(env, generation);
  const seeds: GraphSeed[] = (
    await q<{ entity_id: number; slot: number; score: number }>(
      env.CORE_DB,
      `SELECT entity_id,slot,score FROM graph_seed WHERE generation=?`,
      generation,
    )
  ).map((row) => ({ entityId: row.entity_id, slot: row.slot, score: row.score }));
  const maxEntityId =
    Number((await env.CORE_DB.prepare(`SELECT MAX(entity_id) m FROM entity_dictionary`).first<{ m: number }>())?.m) ||
    0;
  const edges = await readEdges(env, generation);
  const graph = buildDenseGraph(edges, maxEntityId);
  const { trust, distrust } = computeGraphScores(graph, edges, seeds);

  const address = await publishSignalScores(env, graph, trust, distrust, "address");
  const asset = await publishSignalScores(env, graph, trust, distrust, "asset");
  await env.CORE_DB.batch(
    (
      [
        ["graph_cut_addr_trust", address.trustCut],
        ["graph_cut_addr_distrust", address.distrustCut],
        ["graph_cut_asset_trust", asset.trustCut],
        ["graph_cut_asset_distrust", asset.distrustCut],
        ["graph_generation", generation],
      ] as Array<[string, number]>
    ).map(([key, value]) =>
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).bind(key, String(value)),
    ),
  );
  return {
    nodes: graph.nodeCount,
    edges: edges.edgeCount,
    addressUpdates: address.updates,
    assetUpdates: asset.updates,
  };
}

// ---------------------------------------------------------------------------------------------------
// The edge build op list (bounded units advanced per tick) and the phase driver.
// ---------------------------------------------------------------------------------------------------
function buildOps(generation: number, bipartite: boolean): { name: string; exec: (env: Env) => Promise<void> }[] {
  const runSql = (sql: string) => async (env: Env) => {
    await env.CORE_DB.prepare(sql).run();
  };
  const ops: { name: string; exec: (env: Env) => Promise<void> }[] = [
    {
      name: "reset",
      exec: async (env) => {
        // Keep the ACTIVE published generation readable while this one builds; clean everything older,
        // plus this generation's own rows so a resumed build stays idempotent.
        const active = int(await getState(env.CORE_DB, "graph_generation"), 0);
        for (const table of ["graph_seed", "graph_edges"]) {
          await env.CORE_DB.prepare(`DELETE FROM ${table} WHERE generation<>? AND generation<>?`)
            .bind(generation, active)
            .run();
          await env.CORE_DB.prepare(`DELETE FROM ${table} WHERE generation=?`).bind(generation).run();
        }
      },
    },
  ];
  ENTITY_IDENTITY_STATEMENTS.forEach((sql, i) => ops.push({ name: `identity_${i}`, exec: runSql(sql) }));
  entityEdgeStatements(generation, bipartite).forEach((sql, i) => ops.push({ name: `edges_${i}`, exec: runSql(sql) }));
  return ops;
}

export interface GraphBuildProgress {
  phase: string;
  done: boolean;
  build?: { at: number; of: number; ran: string[] };
  score?: ScoreSummary;
  note?: string;
}

async function graphTip(env: Env): Promise<number> {
  return Number((await env.CORE_DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
}

export async function buildGraphTrust(
  env: Env,
  opts: { work?: number; reset?: boolean; bipartite?: boolean } = {},
): Promise<GraphBuildProgress> {
  const work = Math.max(1, Math.min(40, opts.work ?? DEFAULT_WORK));
  if (opts.reset) {
    const active = int(await getState(env.CORE_DB, "graph_generation"), 0);
    await setState(env.CORE_DB, K_GENERATION, active + 1);
    await setState(env.CORE_DB, K_PHASE, "build");
    await setState(env.CORE_DB, K_BUILD, "0");
    // captured at reset so every resumed call constructs the same deterministic op list
    await setState(env.CORE_DB, "graph_bipartite", opts.bipartite ? "1" : "0");
  }
  const generation = int(await getState(env.CORE_DB, K_GENERATION), 1);
  const bipartite = (await getState(env.CORE_DB, "graph_bipartite")) === "1";
  let phase = (await getState(env.CORE_DB, K_PHASE)) || "done";
  if (!["build", "score", "done"].includes(phase)) phase = "done";

  if (phase === "build") {
    const ops = buildOps(generation, bipartite);
    let i = int(await getState(env.CORE_DB, K_BUILD), 0);
    if (i < 0 || i > ops.length) i = 0;
    const ran: string[] = [];
    for (let n = 0; n < work && i < ops.length; n++, i++) {
      await ops[i].exec(env);
      ran.push(ops[i].name);
    }
    await setState(env.CORE_DB, K_BUILD, String(i));
    if (i >= ops.length) {
      await setState(env.CORE_DB, K_EDGES_BLOCK, String(await graphTip(env)));
      await setState(env.CORE_DB, K_PHASE, "score");
      return { phase: "build", done: false, build: { at: i, of: ops.length, ran }, note: "build complete -> score" };
    }
    return { phase: "build", done: false, build: { at: i, of: ops.length, ran } };
  }

  if (phase === "score") {
    // The pass takes minutes and the cron ticks every two: a coarse lease keeps invocations from stacking.
    const now = Math.floor(Date.now() / 1000);
    const lease = int(await getState(env.CORE_DB, K_SCORE_LEASE), 0);
    if (now - lease < SCORE_LEASE_SECONDS) return { phase: "score", done: false, note: "score pass in progress" };
    await setState(env.CORE_DB, K_SCORE_LEASE, now);
    try {
      const score = await runScorePass(env, generation);
      await setState(env.CORE_DB, K_PHASE, "done");
      await setState(env.CORE_DB, K_SCORED_BLOCK, String(await graphTip(env)));
      return { phase: "score", done: true, score, note: "scores published to signals" };
    } finally {
      await setState(env.CORE_DB, K_SCORE_LEASE, 0);
    }
  }

  return { phase: "done", done: true, note: "already built; POST with reset=1 to rebuild" };
}

/**
 * Cron driver. Weekly, the score pass re-seeds and re-ranks in one invocation over the persisted edges;
 * every ~8 weeks the edge topology itself rebuilds (bounded ops trickled a few per tick), then scores.
 */
export async function maybeBuildGraph(env: Env): Promise<GraphBuildProgress | { skipped: string }> {
  const phase = (await getState(env.CORE_DB, K_PHASE)) || "done";
  if (phase === "build") return await buildGraphTrust(env, { work: 4 });
  if (phase === "score") return await buildGraphTrust(env, {});
  const tip = await graphTip(env);
  const edgesBuilt = int(await getState(env.CORE_DB, K_EDGES_BLOCK), 0);
  const scored = int(await getState(env.CORE_DB, K_SCORED_BLOCK), 0);
  if (edgesBuilt === 0) {
    // First run after the in-memory migration: the persisted edges are current, so just start the clock.
    await setState(env.CORE_DB, K_EDGES_BLOCK, String(tip));
    return { skipped: "edge clock started" };
  }
  if (tip - edgesBuilt >= EDGE_REBUILD_BLOCKS) {
    const bipartite = (await getState(env.CORE_DB, "graph_bipartite")) === "1";
    return await buildGraphTrust(env, { reset: true, work: 4, bipartite });
  }
  if (tip - scored >= WEEK_BLOCKS) {
    await setState(env.CORE_DB, K_PHASE, "score");
    return await buildGraphTrust(env, {});
  }
  return { skipped: `fresh (${tip - scored}/${WEEK_BLOCKS} blocks to next score)` };
}
