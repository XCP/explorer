/**
 * Graph-reputation trait (Phase C) — the bounded, resumable job that builds a STANDALONE Min-k-PPR TrustRank +
 * reverse-graph Anti-TrustRank scorer over the money-flow graph, and writes graph_trust / graph_distrust onto
 * the signals tables. The Env-free math (edge/pass/finalize SQL, k-split, tier) lives in graph-core.ts so the
 * validation harness can import it without the Worker Env. See docs/graph-reputation.md for the basis.
 *
 * This is NOT one of the reputation/config.ts factors: it never enters the additive scorer. It is served on its
 * own as trusted / distrusted / unscored TIERS (never a 0-100 continuum).
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
import { getIndexerState as getState, setIndexerState as setState } from "#api/indexer/state";
import { q } from "#api/db";
import {
  K,
  DISTRUST_SLOT,
  PASSES,
  ASSET_PREFIX,
  seedSubset,
  passStatements,
  finalizeStatements,
  EDGE_INSERTS,
  BIPARTITE_EDGE_INSERTS,
  NODE_INSERTS,
  RANK_INIT,
  SEED_APPLY,
} from "#api/indexer/graph-core";
import { rawSqlExpr } from "#api/reputation/score";
import { ASSET_FACTORS, ASSET_TIERS } from "#api/reputation/config";

const DEFAULT_WORK = 8; // work units (build ops OR slot-passes) advanced per admin call

// indexer_state cursor keys
const K_PHASE = "graph_phase"; // "build" | "iterate" | "finalize" | "done"
const K_BUILD = "graph_build_i"; // cursor into the build-op list
const K_PASS = "graph_pass_i"; // cursor 0..(K+1)*PASSES over the interleaved slot-passes

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
      env.DB,
      `SELECT DISTINCT issuer FROM assets WHERE issuer IS NOT NULL AND asset IN (${ph})`,
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
async function applySeeds(env: Env): Promise<void> {
  const tagPh = COLLECTION_TAGS.map(() => "?").join(",");
  const archPh = TRUST_ARCHETYPES.map(() => "?").join(",");
  const excluded = new Set(
    (await q<{ key: string }>(env.DB, `SELECT key FROM curated WHERE kind IN ('exchange','burn')`)).map((r) => r.key),
  );
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;

  // ---- TRUST ASSETS: grails + curated collections + Established+ by our QUALITY score ----
  const grails = (await q<{ key: string }>(env.DB, `SELECT key FROM curated WHERE kind='grail'`)).map((r) => r.key);
  const collAssets = (
    await q<{ a: string }>(
      env.DB,
      `SELECT DISTINCT entity_id a FROM tags WHERE entity_type='asset' AND tag IN (${tagPh})`,
      ...COLLECTION_TAGS,
    )
  ).map((r) => r.a);
  const estCut = ASSET_TIERS.find((t) => t.tier === "Established")?.minRaw ?? 45.86;
  const qualExpr = rawSqlExpr(ASSET_FACTORS, tip); // the asset quality raw, in SQL (same expr as /reputation/review)
  // low_quality=0: the −6 penalty doesn't fully demote a curated-junk asset on the Phase-B scale (a wash/bridge
  // token can ride real flow to Established), so a flagged asset must NEVER become a trust seed via quality.
  const quality = (
    await q<{ a: string }>(
      env.DB,
      `SELECT asset a FROM asset_signals WHERE low_quality=0 AND (trades>0 OR dispenses>0) AND (${qualExpr}) >= ${estCut}`,
    )
  ).map((r) => r.a);
  const trust = new Set<string>();
  for (const a of [...grails, ...collAssets, ...quality]) trust.add(ASSET_PREFIX + a);

  // ---- TRUST ADDRESSES: proven-ecosystem archetype tags, never infra/scam (+ grail issuers as axioms) ----
  const trustAddrs = (
    await q<{ address: string }>(
      env.DB,
      `SELECT DISTINCT t.entity_id address FROM tags t JOIN address_signals sig ON sig.address=t.entity_id
      WHERE t.entity_type='address' AND t.tag IN (${archPh}) AND ${NOT_INFRA_OR_SCAM}`,
      ...TRUST_ARCHETYPES,
    )
  ).map((r) => r.address);
  const grailIssuers = await distinctIssuers(env, grails); // a grail's creator is an axiom, even if under the creator threshold
  for (const address of [...trustAddrs, ...grailIssuers]) if (!excluded.has(address)) trust.add(address);

  // ---- DISTRUST (unchanged): curated lowq + their issuers + derived scam actors ----
  const lowqs = (await q<{ key: string }>(env.DB, `SELECT key FROM curated WHERE kind='lowq'`)).map((r) => r.key);
  const distrust = new Set<string>();
  for (const l of lowqs) distrust.add(ASSET_PREFIX + l);
  for (const a of await distinctIssuers(env, lowqs)) if (!excluded.has(a)) distrust.add(a);
  const scamActors = (
    await q<{ address: string }>(
      env.DB,
      `SELECT address FROM address_signals WHERE shell_scams > 0 OR vault_scams > 0 OR dump_scams > 0`,
    )
  ).map((r) => r.address);
  for (const a of scamActors) if (!excluded.has(a)) distrust.add(a);
  for (const n of trust) distrust.delete(n); // trust wins the (rare) collision to keep Σs=1 exact

  // ---- STAGE: split trust k ways (Min-k), distrust into its slot; batch the ~13k inserts (not one-at-a-time) ----
  const subsets: string[][] = Array.from({ length: K }, () => []);
  for (const key of trust) subsets[seedSubset(key)].push(key);
  const rows: [string, number, number][] = [];
  subsets.forEach((sub, slot) => {
    const s = sub.length ? 1 / sub.length : 0;
    for (const node of sub) rows.push([node, slot, s]);
  });
  const dArr = [...distrust];
  const ds = dArr.length ? 1 / dArr.length : 0;
  for (const node of dArr) rows.push([node, DISTRUST_SLOT, ds]);

  await env.DB.prepare(`DELETE FROM graph_seed`).run();
  const stmts = chunk(rows, 30)
    .filter((p) => p.length)
    .map((part) =>
      env.DB.prepare(
        `INSERT INTO graph_seed (node,slot,s) VALUES ${part.map(() => "(?,?,?)").join(",")}
         ON CONFLICT(node,slot) DO UPDATE SET s=excluded.s`,
      ).bind(...part.flat()),
    );
  for (const b of chunk(stmts, 20)) await env.DB.batch(b);
  await env.DB.prepare(SEED_APPLY).run();
}

// the ordered build operations (each a bounded unit of work advanced by the cursor). The bipartite flag
// is captured in indexer_state at reset so every resumed call constructs the SAME deterministic op list.
function buildOps(bipartite: boolean): { name: string; exec: (env: Env) => Promise<void> }[] {
  const runSql = (sql: string) => async (env: Env) => {
    await env.DB.prepare(sql).run();
  };
  const ops: { name: string; exec: (env: Env) => Promise<void> }[] = [
    {
      name: "reset",
      exec: async (env) => {
        await env.DB.prepare(`DELETE FROM graph_edges`).run();
        await env.DB.prepare(`DELETE FROM graph_node`).run();
        await env.DB.prepare(`DELETE FROM graph_rank`).run();
        await env.DB.prepare(`DELETE FROM graph_seed`).run();
      },
    },
  ];
  EDGE_INSERTS.forEach((sql, i) => ops.push({ name: `edges_${i}`, exec: runSql(sql) }));
  if (bipartite) BIPARTITE_EDGE_INSERTS.forEach((sql, i) => ops.push({ name: `bip_${i}`, exec: runSql(sql) }));
  NODE_INSERTS.forEach((sql, i) => ops.push({ name: `node_${i}`, exec: runSql(sql) }));
  RANK_INIT.forEach((sql, i) => ops.push({ name: `rank_init_${i}`, exec: runSql(sql) }));
  ops.push({ name: "seeds", exec: applySeeds });
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
    await setState(env.DB, K_PHASE, "build");
    await setState(env.DB, K_BUILD, "0");
    await setState(env.DB, K_PASS, "0");
    // captured at reset so every resumed call constructs the same deterministic op list
    await setState(env.DB, "graph_bipartite", opts.bipartite ? "1" : "0");
  }
  const bipartite = (await getState(env.DB, "graph_bipartite")) === "1";
  let phase = (await getState(env.DB, K_PHASE)) || "build";
  if (!["build", "iterate", "finalize", "done"].includes(phase)) phase = "build";

  if (phase === "build") {
    const ops = buildOps(bipartite);
    let i = int(await getState(env.DB, K_BUILD), 0);
    if (i < 0 || i > ops.length) i = 0;
    const ran: string[] = [];
    for (let n = 0; n < work && i < ops.length; n++, i++) {
      await ops[i].exec(env);
      ran.push(ops[i].name);
    }
    await setState(env.DB, K_BUILD, String(i));
    if (i >= ops.length) {
      await setState(env.DB, K_PHASE, "iterate");
      return { phase: "build", done: false, build: { at: i, of: ops.length, ran }, note: "build complete -> iterate" };
    }
    return { phase: "build", done: false, build: { at: i, of: ops.length, ran } };
  }

  if (phase === "iterate") {
    const total = (K + 1) * PASSES;
    let step = int(await getState(env.DB, K_PASS), 0);
    if (step < 0 || step > total) step = 0;
    const ran: string[] = [];
    for (let n = 0; n < work && step < total; n++, step++) {
      const slot = step % (K + 1);
      for (const sql of passStatements(slot, slot === DISTRUST_SLOT)) await env.DB.prepare(sql).run();
      ran.push(`slot${slot}#${Math.floor(step / (K + 1))}`);
    }
    await setState(env.DB, K_PASS, String(step));
    if (step >= total) {
      await setState(env.DB, K_PHASE, "finalize");
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
    for (const sql of finalizeStatements()) await env.DB.prepare(sql).run();
    await setState(env.DB, K_PHASE, "done");
    return { phase: "finalize", done: true, finalize: true, note: "graph_trust/graph_distrust written to signals" };
  }

  return { phase: "done", done: true, note: "already built; POST with reset=1 to rebuild" };
}

// ~7 days of Counterparty blocks — the auto-rebuild cadence (the graph moves slowly; weekly is ample).
const WEEK_BLOCKS = 1008;
async function graphTip(env: Env): Promise<number> {
  return Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
}

/**
 * Cron driver: keeps the graph trait from going stale WITHOUT a heavy per-tick cost. If a rebuild is in
 * progress, advance a couple of work-units (one iterate pass ≈ 20s — safe inside a 2-min tick); if idle,
 * kick a fresh reset once WEEK_BLOCKS have elapsed since the last finalize. So a full Min-k-PPR rebuild
 * (incl. the freshly-seeded scam actors) trickles to completion over a few hours, once a week, on its own.
 */
export async function maybeBuildGraph(env: Env): Promise<GraphBuildProgress | { skipped: string }> {
  const phase = (await getState(env.DB, K_PHASE)) || "done";
  if (phase === "done") {
    const tip = await graphTip(env);
    const last = int(await getState(env.DB, "graph_rebuilt_block"), 0);
    if (last === 0) {
      await setState(env.DB, "graph_rebuilt_block", String(tip));
      return { skipped: "clock started" };
    }
    if (tip - last >= WEEK_BLOCKS) return await buildGraphTrust(env, { reset: true });
    return { skipped: `fresh (${tip - last}/${WEEK_BLOCKS} blocks to next rebuild)` };
  }
  const r = await buildGraphTrust(env, { work: 4 }); // single-driver (cron owns the rebuild); a few units/tick
  if (r.done) await setState(env.DB, "graph_rebuilt_block", String(await graphTip(env)));
  return r;
}
