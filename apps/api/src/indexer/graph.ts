/**
 * Graph-reputation trait (Phase C) — the bounded, resumable job that builds a STANDALONE Min-k-PPR TrustRank +
 * reverse-graph Anti-TrustRank scorer over the money-flow graph, and writes graph_trust / graph_distrust onto
 * the signals tables. The Env-free math (edge/pass/finalize SQL, k-split, tier) lives in graph-core.ts so the
 * validation harness can import it without the Worker Env. See docs/graph-reputation.md for the basis.
 *
 * This does not enter Address Reputation, Asset Rating, or Conviction. It is served on its own as
 * trusted / distrusted / unscored relationship evidence and supports holder-cohesion analysis.
 *
 * PIPELINE (graph_edges -> graph_node -> graph_rank -> signals):
 *   EDGES: address->address from sends (source->destination), order_matches (BOTH directions), dispenses
 *          (buyer->creator, origin-aware via COALESCE(dispensers.origin, dispenses.source)); PLUS bipartite
 *          holder<->asset and asset<->issuer (both directions) so a grail (an ASSET seed) reaches its holders ->
 *          their holdings and its issuer, while address-side seeds reach assets. Weight = ln(1+count) for
 *          address pairs, ln(2) for bipartite edges. Curated exchanges + burns are conduits, not endorsers, so
 *          every edge whose SOURCE is an exchange/burn is DROPPED (they may receive trust — sinks — never emit).
 *   SEEDS: trust = grail assets + their issuers + holders of >=2 distinct grails; distrust = low-quality assets
 *          + their issuers. Exchanges/burns never seed. Trust seeds split k=3 ways by seedSubset (FNV-1a).
 *   ITERATE: ~20 degree-normalized PPR passes (damping 0.85) per slot as set-based UPDATE-JOINs; slots 0..K-1
 *          forward (trust subsets), slot K reverse (distrust). trust = MIN over the k subsets; distrust = slot K.
 */
import type { Env } from "#api/env";
import { q } from "#api/db";
import {
  K,
  DISTRUST_SLOT,
  PASSES,
  seedSubset,
  ENTITY_IDENTITY_STATEMENTS,
  entityEdgeStatements,
  entityNodeStatements,
  entityRankInitStatements,
  entitySeedApplyStatement,
  entitySeedInsertStatement,
  entityPassStatements,
  entityFinalizeStatements,
} from "#api/indexer/graph-core";

const DEFAULT_WORK = 8; // work units (build ops OR slot-passes) advanced per admin call

// indexer_state cursor keys
const K_PHASE = "graph_phase"; // "build" | "iterate" | "finalize" | "done"
const K_BUILD = "graph_build_i"; // cursor into the build-op list
const K_PASS = "graph_pass_i"; // cursor 0..(K+1)*PASSES over the interleaved slot-passes
const K_GENERATION = "graph_build_generation";

const getState = async (db: D1Database, key: string): Promise<string | null> =>
  (await db.prepare(`SELECT value FROM core_state WHERE key=?`).bind(key).first<{ value: string }>())?.value ?? null;
const setState = async (db: D1Database, key: string, value: string | number): Promise<void> => {
  await db
    .prepare(`INSERT INTO core_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .bind(key, String(value))
    .run();
};

// ---- small state + chunk helpers (same shape as signals.ts) ----
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
// SEEDS. Compute the trust/distrust node sets from curated + the mirror, split trust k ways, stage them in
// graph_seed, then apply. Chunk sizes respect D1's 100-bound-parameters-per-query limit (30 rows x 3 vars).
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
  AND sig.likely_service=0 AND COALESCE(sig.shell_scams,0)=0 AND COALESCE(sig.vault_scams,0)=0`;

/**
 * Trust the ART by our QUALITY score, trust PEOPLE by our reputation ARCHETYPES — the trust signals we
 * already compute, not a flat cohort. Trust-asset seeds = curated grails + every curated-collection card +
 * algorithmically Established+ assets (the quality score's top tier — fixes the BITCRYSTALS class of legit
 * currencies grail-trust never reached). Trust-ADDRESS seeds = the good-actor archetype tags (collector /
 * creator / prolific_creator / dividend_payer), never infra or a scammer. Seeds are high-precision; the graph
 * propagates from them. Distrust unchanged.
 */
async function applySeeds(env: Env, generation: number): Promise<void> {
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

  // ---- DISTRUST (unchanged): curated lowq + their issuers + derived scam actors ----
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

  // ---- STAGE: split trust k ways (Min-k), distrust into its slot; batch the ~13k inserts (not one-at-a-time) ----
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

  const stmts = chunk(rows, 20)
    .filter((p) => p.length)
    .map((part) => env.CORE_DB.prepare(entitySeedInsertStatement(generation, part.length)).bind(...part.flat()));
  for (const b of chunk(stmts, 20)) await env.CORE_DB.batch(b);
  await env.CORE_DB.prepare(entitySeedApplyStatement(generation)).run();
}

// the ordered build operations (each a bounded unit of work advanced by the cursor). The bipartite flag
// is captured in indexer_state at reset so every resumed call constructs the SAME deterministic op list.
function buildOps(generation: number, bipartite: boolean): { name: string; exec: (env: Env) => Promise<void> }[] {
  const runSql = (sql: string) => async (env: Env) => {
    await env.CORE_DB.prepare(sql).run();
  };
  const ops: { name: string; exec: (env: Env) => Promise<void> }[] = [
    {
      name: "reset",
      exec: async (env) => {
        for (const table of ["graph_inflow", "graph_seed", "graph_rank", "graph_node", "graph_edges"])
          await env.CORE_DB.prepare(`DELETE FROM ${table} WHERE generation=?`).bind(generation).run();
      },
    },
  ];
  ENTITY_IDENTITY_STATEMENTS.forEach((sql, i) => ops.push({ name: `identity_${i}`, exec: runSql(sql) }));
  entityEdgeStatements(generation, bipartite).forEach((sql, i) => ops.push({ name: `edges_${i}`, exec: runSql(sql) }));
  entityNodeStatements(generation).forEach((sql, i) => ops.push({ name: `node_${i}`, exec: runSql(sql) }));
  entityRankInitStatements(generation).forEach((sql, i) => ops.push({ name: `rank_init_${i}`, exec: runSql(sql) }));
  ops.push({ name: "seeds", exec: (env) => applySeeds(env, generation) });
  return ops;
}

// ---------------------------------------------------------------------------------------------------
// The bounded, resumable job. Phases: build -> iterate -> finalize -> done. Each call advances `work` units
// within the current phase; when a phase completes it flips the phase cursor and returns (caller loops).
// ---------------------------------------------------------------------------------------------------
export interface GraphBuildProgress {
  phase: string;
  done: boolean;
  build?: { at: number; of: number; ran: string[] };
  iterate?: { step: number; of: number; ran: string[] };
  finalize?: boolean;
  note?: string;
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
    await setState(env.CORE_DB, K_PASS, "0");
    // captured at reset so every resumed call constructs the same deterministic op list
    await setState(env.CORE_DB, "graph_bipartite", opts.bipartite ? "1" : "0");
  }
  const generation = int(await getState(env.CORE_DB, K_GENERATION), 1);
  const bipartite = (await getState(env.CORE_DB, "graph_bipartite")) === "1";
  let phase = (await getState(env.CORE_DB, K_PHASE)) || "build";
  if (!["build", "iterate", "finalize", "done"].includes(phase)) phase = "build";

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
      await setState(env.CORE_DB, K_PHASE, "iterate");
      return { phase: "build", done: false, build: { at: i, of: ops.length, ran }, note: "build complete -> iterate" };
    }
    return { phase: "build", done: false, build: { at: i, of: ops.length, ran } };
  }

  if (phase === "iterate") {
    const total = (K + 1) * PASSES;
    let step = int(await getState(env.CORE_DB, K_PASS), 0);
    if (step < 0 || step > total) step = 0;
    const ran: string[] = [];
    for (let n = 0; n < work && step < total; n++, step++) {
      const slot = step % (K + 1);
      for (const sql of entityPassStatements(generation, slot, slot === DISTRUST_SLOT))
        await env.CORE_DB.prepare(sql).run();
      ran.push(`slot${slot}#${Math.floor(step / (K + 1))}`);
    }
    await setState(env.CORE_DB, K_PASS, String(step));
    if (step >= total) {
      await setState(env.CORE_DB, K_PHASE, "finalize");
      return {
        phase: "iterate",
        done: false,
        iterate: { step, of: total, ran },
        note: "iteration complete -> finalize",
      };
    }
    return { phase: "iterate", done: false, iterate: { step, of: total, ran } };
  }

  if (phase === "finalize") {
    await env.CORE_DB.batch(entityFinalizeStatements(generation).map((sql) => env.CORE_DB.prepare(sql)));
    await setState(env.CORE_DB, K_PHASE, "done");
    return { phase: "finalize", done: true, finalize: true, note: "graph_trust/graph_distrust written to signals" };
  }

  return { phase: "done", done: true, note: "already built; POST with reset=1 to rebuild" };
}

// ~7 days of Counterparty blocks — the auto-rebuild cadence (the graph moves slowly; weekly is ample).
const WEEK_BLOCKS = 1008;
async function graphTip(env: Env): Promise<number> {
  return Number((await env.CORE_DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
}

/**
 * Cron driver: keeps the graph trait from going stale WITHOUT a heavy per-tick cost. If a rebuild is in
 * progress, advance a couple of work-units (one iterate pass ≈ 20s — safe inside a 2-min tick); if idle,
 * kick a fresh reset once WEEK_BLOCKS have elapsed since the last finalize. So a full Min-k-PPR rebuild
 * (incl. the freshly-seeded scam actors) trickles to completion over a few hours, once a week, on its own.
 */
export async function maybeBuildGraph(env: Env): Promise<GraphBuildProgress | { skipped: string }> {
  const phase = (await getState(env.CORE_DB, K_PHASE)) || "done";
  if (phase === "done") {
    const tip = await graphTip(env);
    const last = int(await getState(env.CORE_DB, "graph_rebuilt_block"), 0);
    if (last === 0) {
      await setState(env.CORE_DB, "graph_rebuilt_block", String(tip));
      return { skipped: "clock started" };
    }
    if (tip - last >= WEEK_BLOCKS) return await buildGraphTrust(env, { reset: true });
    return { skipped: `fresh (${tip - last}/${WEEK_BLOCKS} blocks to next rebuild)` };
  }
  const r = await buildGraphTrust(env, { work: 4 }); // single-driver (cron owns the rebuild); a few units/tick
  if (r.done) await setState(env.CORE_DB, "graph_rebuilt_block", String(await graphTip(env)));
  return r;
}
