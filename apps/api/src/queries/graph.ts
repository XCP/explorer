/**
 * Read-side SQL for the graph-reputation trait (Phase C). Owns the queries the read/graph.ts router serves:
 * the per-entity (trust, distrust) lookup, the tier distribution + zero-coverage metric, and the trusted /
 * distrusted leaderboards. Tier classification itself is the pure graphTier() in src/indexer/graph.ts — the
 * COUNT(*) CASE here mirrors it exactly (unscored: t<=0 AND d<=0; distrusted: d>t; trusted: t>0 AND d<=t).
 */
import { q, one } from "#api/db";
import type { GraphCuts } from "#api/indexer/graph-core";

export interface GraphScoreRow {
  trust: number;
  distrust: number;
}
export interface GraphTopRow {
  key: string;
  trust: number;
  distrust: number;
}
export interface GraphTierCounts {
  trusted: number;
  distrusted: number;
  unscored: number;
  total: number;
  zero_fraction: number;
}

/** Tier cuts computed at finalize (p90 of the positive mass; see graph-core finalizeStatements). */
export async function graphCuts(db: D1Database): Promise<{ address: GraphCuts; asset: GraphCuts }> {
  const rows = await q<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM indexer_state WHERE key IN ('graph_cut_addr_trust','graph_cut_addr_distrust','graph_cut_asset_trust','graph_cut_asset_distrust')`,
  );
  const v = (k: string) => Number(rows.find((r) => r.key === k)?.value) || 0;
  return {
    address: { trust: v("graph_cut_addr_trust"), distrust: v("graph_cut_addr_distrust") },
    asset: { trust: v("graph_cut_asset_trust"), distrust: v("graph_cut_asset_distrust") },
  };
}

// per-entity score. table/keyCol are fixed literals chosen by the caller (never user input).
export async function graphScore(
  db: D1Database,
  table: "address_signals" | "asset_signals",
  keyCol: "address" | "asset",
  id: string,
): Promise<GraphScoreRow | null> {
  const r = await one<{ trust: number; distrust: number }>(
    db,
    `SELECT COALESCE(graph_trust,0) trust, COALESCE(graph_distrust,0) distrust FROM ${table} WHERE ${keyCol}=?`,
    id,
  );
  return r ? { trust: r.trust, distrust: r.distrust } : null;
}

// mirrors graphTier(t, d, cuts): distrusted = d>t AND d>dcut; trusted = t>0 AND t>=d AND t>=tcut; else unscored.
async function tierCounts(
  db: D1Database,
  table: "address_signals" | "asset_signals",
  cuts: GraphCuts,
): Promise<GraphTierCounts> {
  const r = await one<{ trusted: number; distrusted: number; total: number; zero: number }>(
    db,
    `SELECT
       SUM(CASE WHEN gt>0 AND gt>=gd AND gt>=${cuts.trust} THEN 1 ELSE 0 END) trusted,
       SUM(CASE WHEN gd>gt AND gd>${cuts.distrust} THEN 1 ELSE 0 END) distrusted,
       SUM(CASE WHEN gt<=0 AND gd<=0 THEN 1 ELSE 0 END) zero,
       COUNT(*) total
     FROM (SELECT COALESCE(graph_trust,0) gt, COALESCE(graph_distrust,0) gd FROM ${table})`,
  );
  const total = r?.total ?? 0;
  const trusted = r?.trusted ?? 0,
    distrusted = r?.distrusted ?? 0;
  return {
    trusted,
    distrusted,
    unscored: total - trusted - distrusted, // incl. weak-positive below the cuts (not enough evidence)
    total,
    zero_fraction: total ? (r?.zero ?? 0) / total : 0, // the monitored coverage metric (docs/graph-reputation.md)
  };
}

// Curated exchanges/burns are conduits: they emit no trust but still RECEIVE it (the first prod run put two
// exchanges in the address top-12) — infra is excluded from the address leaderboards.
function topBy(
  db: D1Database,
  table: "address_signals" | "asset_signals",
  keyCol: "address" | "asset",
  col: "graph_trust" | "graph_distrust",
  limit = 20,
): Promise<GraphTopRow[]> {
  const infra =
    keyCol === "address" ? `AND address NOT IN (SELECT key FROM curated WHERE kind IN ('exchange','burn'))` : "";
  return q<GraphTopRow>(
    db,
    `SELECT ${keyCol} key, COALESCE(graph_trust,0) trust, COALESCE(graph_distrust,0) distrust
     FROM ${table} WHERE ${col} > 0 ${infra} ORDER BY ${col} DESC LIMIT ?`,
    limit,
  );
}

export interface GraphOverview {
  cuts: { address: GraphCuts; asset: GraphCuts };
  addresses: { tiers: GraphTierCounts; top_trusted: GraphTopRow[]; top_distrusted: GraphTopRow[] };
  assets: { tiers: GraphTierCounts; top_trusted: GraphTopRow[]; top_distrusted: GraphTopRow[] };
}

export async function graphOverview(db: D1Database): Promise<GraphOverview> {
  const cuts = await graphCuts(db);
  const [aTiers, aTrust, aDistrust, sTiers, sTrust, sDistrust] = await Promise.all([
    tierCounts(db, "address_signals", cuts.address),
    topBy(db, "address_signals", "address", "graph_trust"),
    topBy(db, "address_signals", "address", "graph_distrust"),
    tierCounts(db, "asset_signals", cuts.asset),
    topBy(db, "asset_signals", "asset", "graph_trust"),
    topBy(db, "asset_signals", "asset", "graph_distrust"),
  ]);
  return {
    cuts,
    addresses: { tiers: aTiers, top_trusted: aTrust, top_distrusted: aDistrust },
    assets: { tiers: sTiers, top_trusted: sTrust, top_distrusted: sDistrust },
  };
}
