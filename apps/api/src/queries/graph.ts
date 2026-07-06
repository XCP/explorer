/**
 * Read-side SQL for the graph-reputation trait (Phase C). Owns the queries the read/graph.ts router serves:
 * the per-entity (trust, distrust) lookup, the tier distribution + zero-coverage metric, and the trusted /
 * distrusted leaderboards. Tier classification itself is the pure graphTier() in src/indexer/graph.ts — the
 * COUNT(*) CASE here mirrors it exactly (unscored: t<=0 AND d<=0; distrusted: d>t; trusted: t>0 AND d<=t).
 */
import { q, one } from "../db";

export interface GraphScoreRow { trust: number; distrust: number }
export interface GraphTopRow { key: string; trust: number; distrust: number }
export interface GraphTierCounts { trusted: number; distrusted: number; unscored: number; total: number; zero_fraction: number }

// per-entity score. table/keyCol are fixed literals chosen by the caller (never user input).
export async function graphScore(
  db: D1Database, table: "address_signals" | "asset_signals", keyCol: "addr" | "asset", id: string,
): Promise<GraphScoreRow | null> {
  const r = await one<{ trust: number; distrust: number }>(
    db, `SELECT COALESCE(graph_trust,0) trust, COALESCE(graph_distrust,0) distrust FROM ${table} WHERE ${keyCol}=?`, id);
  return r ? { trust: r.trust, distrust: r.distrust } : null;
}

async function tierCounts(db: D1Database, table: "address_signals" | "asset_signals"): Promise<GraphTierCounts> {
  const r = await one<{ trusted: number; distrusted: number; unscored: number; total: number }>(db,
    `SELECT
       SUM(CASE WHEN gt>0 AND gd<=gt THEN 1 ELSE 0 END) trusted,
       SUM(CASE WHEN gd>gt THEN 1 ELSE 0 END) distrusted,
       SUM(CASE WHEN gt<=0 AND gd<=0 THEN 1 ELSE 0 END) unscored,
       COUNT(*) total
     FROM (SELECT COALESCE(graph_trust,0) gt, COALESCE(graph_distrust,0) gd FROM ${table})`);
  const total = r?.total ?? 0;
  const unscored = r?.unscored ?? 0;
  return {
    trusted: r?.trusted ?? 0,
    distrusted: r?.distrusted ?? 0,
    unscored,
    total,
    zero_fraction: total ? unscored / total : 0,   // the monitored coverage metric (docs/graph-reputation.md)
  };
}

function topBy(db: D1Database, table: "address_signals" | "asset_signals", keyCol: "addr" | "asset", col: "graph_trust" | "graph_distrust", limit = 20): Promise<GraphTopRow[]> {
  return q<GraphTopRow>(db,
    `SELECT ${keyCol} key, COALESCE(graph_trust,0) trust, COALESCE(graph_distrust,0) distrust
     FROM ${table} WHERE ${col} > 0 ORDER BY ${col} DESC LIMIT ?`, limit);
}

export interface GraphOverview {
  addresses: { tiers: GraphTierCounts; top_trusted: GraphTopRow[]; top_distrusted: GraphTopRow[] };
  assets: { tiers: GraphTierCounts; top_trusted: GraphTopRow[]; top_distrusted: GraphTopRow[] };
}

export async function graphOverview(db: D1Database): Promise<GraphOverview> {
  const [aTiers, aTrust, aDistrust, sTiers, sTrust, sDistrust] = await Promise.all([
    tierCounts(db, "address_signals"),
    topBy(db, "address_signals", "addr", "graph_trust"),
    topBy(db, "address_signals", "addr", "graph_distrust"),
    tierCounts(db, "asset_signals"),
    topBy(db, "asset_signals", "asset", "graph_trust"),
    topBy(db, "asset_signals", "asset", "graph_distrust"),
  ]);
  return {
    addresses: { tiers: aTiers, top_trusted: aTrust, top_distrusted: aDistrust },
    assets: { tiers: sTiers, top_trusted: sTrust, top_distrusted: sDistrust },
  };
}
