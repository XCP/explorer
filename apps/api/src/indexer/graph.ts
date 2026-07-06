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
import type { Env } from "../index";
import { q } from "../db";
import {
  K, DISTRUST_SLOT, PASSES, ASSET_PREFIX,
  seedSubset, passStatements, finalizeStatements, EDGE_INSERTS, NODE_INSERTS, RANK_INIT, SEED_APPLY,
} from "./graph-core";

const DEFAULT_WORK = 8; // work units (build ops OR slot-passes) advanced per admin call

// indexer_state cursor keys
const K_PHASE = "graph_phase";     // "build" | "iterate" | "finalize" | "done"
const K_BUILD = "graph_build_i";   // cursor into the build-op list
const K_PASS = "graph_pass_i";     // cursor 0..(K+1)*PASSES over the interleaved slot-passes

// ---- small state + chunk helpers (same shape as signals.ts) ----
async function getState(env: Env, k: string): Promise<string | null> {
  return ((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) ?? null;
}
async function setState(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v).run();
}
const chunk = <T>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const int = (v: string | null, d: number): number => { const n = parseInt(v ?? "", 10); return Number.isFinite(n) ? n : d; };

// ---------------------------------------------------------------------------------------------------
// SEEDS. Compute the trust/distrust node sets from curated + the mirror, split trust k ways, stage them in
// graph_seed, then apply. Chunk sizes respect D1's 100-bound-parameters-per-query limit (30 rows x 3 vars).
// ---------------------------------------------------------------------------------------------------
async function distinctIssuers(env: Env, assets: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const part of chunk(assets, 90)) {
    if (!part.length) continue;
    const ph = part.map(() => "?").join(",");
    const r = await q<{ issuer: string }>(env.DB, `SELECT DISTINCT issuer FROM assets WHERE issuer IS NOT NULL AND asset IN (${ph})`, ...part);
    for (const x of r) if (x.issuer) out.add(x.issuer);
  }
  return [...out];
}
// holders of >=2 DISTINCT grails (aggregated across IN-chunks in TS).
async function multiGrailHolders(env: Env, grails: string[]): Promise<string[]> {
  const held = new Map<string, Set<string>>();
  for (const part of chunk(grails, 90)) {
    if (!part.length) continue;
    const ph = part.map(() => "?").join(",");
    const r = await q<{ holder: string; asset: string }>(env.DB,
      `SELECT DISTINCT holder, asset FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 AND asset IN (${ph})`, ...part);
    for (const x of r) {
      if (!x.holder) continue;
      let s = held.get(x.holder);
      if (!s) held.set(x.holder, (s = new Set()));
      s.add(x.asset);
    }
  }
  const out: string[] = [];
  for (const [h, s] of held) if (s.size >= 2) out.push(h);
  return out;
}

async function applySeeds(env: Env): Promise<void> {
  const grails = (await q<{ key: string }>(env.DB, `SELECT key FROM curated WHERE kind='grail'`)).map((r) => r.key);
  const lowqs = (await q<{ key: string }>(env.DB, `SELECT key FROM curated WHERE kind='lowq'`)).map((r) => r.key);
  const excluded = new Set((await q<{ key: string }>(env.DB, `SELECT key FROM curated WHERE kind IN ('exchange','burn')`)).map((r) => r.key));

  const trust = new Set<string>();
  const distrust = new Set<string>();
  for (const g of grails) trust.add(ASSET_PREFIX + g);
  for (const l of lowqs) distrust.add(ASSET_PREFIX + l);
  for (const a of await distinctIssuers(env, grails)) if (!excluded.has(a)) trust.add(a);
  for (const a of await multiGrailHolders(env, grails)) if (!excluded.has(a)) trust.add(a);
  for (const a of await distinctIssuers(env, lowqs)) if (!excluded.has(a)) distrust.add(a);
  // a node can't be both a trust and a distrust seed — trust wins the (rare) collision to keep Σs=1 exact.
  for (const n of trust) distrust.delete(n);

  const subsets: string[][] = Array.from({ length: K }, () => []);
  for (const key of trust) subsets[seedSubset(key)].push(key);
  const rows: [string, number, number][] = [];
  subsets.forEach((sub, slot) => { const s = sub.length ? 1 / sub.length : 0; for (const node of sub) rows.push([node, slot, s]); });
  const dArr = [...distrust];
  const ds = dArr.length ? 1 / dArr.length : 0;
  for (const node of dArr) rows.push([node, DISTRUST_SLOT, ds]);

  await env.DB.prepare(`DELETE FROM graph_seed`).run();
  for (const part of chunk(rows, 30)) {
    if (!part.length) continue;
    const ph = part.map(() => "(?,?,?)").join(",");
    await env.DB.prepare(`INSERT OR REPLACE INTO graph_seed (node,slot,s) VALUES ${ph}`).bind(...part.flat()).run();
  }
  await env.DB.prepare(SEED_APPLY).run();
}

// the ordered build operations (each a bounded unit of work advanced by the cursor).
function buildOps(): { name: string; exec: (env: Env) => Promise<void> }[] {
  const runSql = (sql: string) => async (env: Env) => { await env.DB.prepare(sql).run(); };
  const ops: { name: string; exec: (env: Env) => Promise<void> }[] = [
    { name: "reset", exec: async (env) => {
      await env.DB.prepare(`DELETE FROM graph_edges`).run();
      await env.DB.prepare(`DELETE FROM graph_node`).run();
      await env.DB.prepare(`DELETE FROM graph_rank`).run();
      await env.DB.prepare(`DELETE FROM graph_seed`).run();
    } },
  ];
  EDGE_INSERTS.forEach((sql, i) => ops.push({ name: `edges_${i}`, exec: runSql(sql) }));
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

export async function buildGraphTrust(env: Env, opts: { work?: number; reset?: boolean } = {}): Promise<GraphBuildProgress> {
  const work = Math.max(1, Math.min(40, opts.work ?? DEFAULT_WORK));
  if (opts.reset) {
    await setState(env, K_PHASE, "build");
    await setState(env, K_BUILD, "0");
    await setState(env, K_PASS, "0");
  }
  let phase = (await getState(env, K_PHASE)) || "build";
  if (!["build", "iterate", "finalize", "done"].includes(phase)) phase = "build";

  if (phase === "build") {
    const ops = buildOps();
    let i = int(await getState(env, K_BUILD), 0);
    if (i < 0 || i > ops.length) i = 0;
    const ran: string[] = [];
    for (let n = 0; n < work && i < ops.length; n++, i++) { await ops[i].exec(env); ran.push(ops[i].name); }
    await setState(env, K_BUILD, String(i));
    if (i >= ops.length) { await setState(env, K_PHASE, "iterate"); return { phase: "build", done: false, build: { at: i, of: ops.length, ran }, note: "build complete -> iterate" }; }
    return { phase: "build", done: false, build: { at: i, of: ops.length, ran } };
  }

  if (phase === "iterate") {
    const total = (K + 1) * PASSES;
    let step = int(await getState(env, K_PASS), 0);
    if (step < 0 || step > total) step = 0;
    const ran: string[] = [];
    for (let n = 0; n < work && step < total; n++, step++) {
      const slot = step % (K + 1);
      for (const sql of passStatements(slot, slot === DISTRUST_SLOT)) await env.DB.prepare(sql).run();
      ran.push(`slot${slot}#${Math.floor(step / (K + 1))}`);
    }
    await setState(env, K_PASS, String(step));
    if (step >= total) { await setState(env, K_PHASE, "finalize"); return { phase: "iterate", done: false, iterate: { step, of: total, ran }, note: "iteration complete -> finalize" }; }
    return { phase: "iterate", done: false, iterate: { step, of: total, ran } };
  }

  if (phase === "finalize") {
    for (const sql of finalizeStatements()) await env.DB.prepare(sql).run();
    await setState(env, K_PHASE, "done");
    return { phase: "finalize", done: true, finalize: true, note: "graph_trust/graph_distrust written to signals" };
  }

  return { phase: "done", done: true, note: "already built; POST with reset=1 to rebuild" };
}
