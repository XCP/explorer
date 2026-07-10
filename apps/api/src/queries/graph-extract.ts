/**
 * Bounded sub-graph extraction for visualization — small, renderable slices of the address interaction graph
 * (graph_edges: directed, weighted src→dst, w = ln(1+interactions)) and the asset↔holder bipartite graph
 * (balances). The point is TOPOLOGY, not a table: for every scope we also pull the edges AMONG the peripheral
 * nodes and cluster them, so a coordinated ring (holders/neighbours that all interact) reads at a glance while
 * an organic, independent crowd stays a diffuse cloud. Capped to a node budget; the full graph is never whole.
 */
import type { GraphNode, GraphEdge, GraphStats } from "@xcp/shared/graph";
import { q } from "../db";

const inList = (ids: string[]) =>
  ids.filter((s) => /^[a-zA-Z0-9._]+$/.test(s)).map((s) => `'${s}'`).join(",") || "''";

// Every active address sits in the graph's giant component, so "connected by ANY edge" is trivially true and
// tells you nothing. Coordination shows up as DENSITY + REPETITION: a wash/sybil ring trades among itself many
// times. So we headline cohesion (edges per peripheral node) and cluster only on STRONG (repeated) edges.
const STRONG_W = 1.6; // ln(1+n) ≥ 1.6  ⇔  ~4+ repeated interactions between the pair (drops incidental single trades)

/** Analyse the peripheral crowd: cluster on strong edges (union-find), and compute the density diagnostics.
 *  Cluster id per node — members of a strong multi-node component get a real cluster, isolated get -1. */
function analyse(ids: string[], edges: { source: string; target: string; weight: number }[]): { clusterOf: Map<string, number>; stats: Omit<GraphStats, "peripheral"> } {
  const strong = edges.filter((e) => e.weight >= STRONG_W && e.source !== e.target);
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
  for (const e of strong) if (parent.has(e.source) && parent.has(e.target)) { const a = find(e.source), b = find(e.target); if (a !== b) parent.set(a, b); }
  const size = new Map<string, number>();
  for (const id of ids) { const r = find(id); size.set(r, (size.get(r) ?? 0) + 1); }
  const bigRoots = [...size.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const rootCluster = new Map(bigRoots.map((r, i) => [r, i]));
  const clusterOf = new Map<string, number>();
  for (const id of ids) clusterOf.set(id, rootCluster.get(find(id)) ?? -1);
  const interEdges = edges.filter((e) => e.source !== e.target).length;
  return {
    clusterOf,
    stats: {
      total: ids.length,
      edges_among: interEdges,
      cohesion: ids.length ? Math.round((interEdges / ids.length) * 100) / 100 : 0, // edges per node — the headline
      strong_edges: strong.length,
      interconnected: ids.filter((id) => clusterOf.get(id)! >= 0).length,
      clusters: bigRoots.length,
      largest_cluster: bigRoots.length ? size.get(bigRoots[0])! : 0,
    },
  };
}

/** One address's ego-network: center + top-N neighbours, WITH neighbour↔neighbour interlinks, clustered so a
 *  clique (a coordinated circle around the hub) stands out from a hub that merely bridges unrelated parties. */
export async function addressEgo(db: D1Database, addr: string, limit: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats }> {
  const nbrs = await q<{ id: string; w: number }>(
    db,
    `WITH nbr AS (SELECT dst id, w FROM graph_edges WHERE src=?1 UNION ALL SELECT src id, w FROM graph_edges WHERE dst=?1)
     SELECT id, ROUND(SUM(w),3) w FROM nbr WHERE id<>?1 GROUP BY id ORDER BY w DESC LIMIT ?2`,
    addr, limit
  );
  const peripheral = nbrs.map((n) => n.id);
  const set = inList([addr, ...peripheral]);
  const allEdges = await q<GraphEdge>(db, `SELECT src source, dst target, ROUND(w,3) weight FROM graph_edges WHERE src IN (${set}) AND dst IN (${set})`);
  // interlinks = edges NOT touching the center → the diagnostic (do the neighbours know each other?)
  const interlinks = allEdges.filter((e) => e.source !== addr && e.target !== addr);
  const { clusterOf, stats } = analyse(peripheral, interlinks);
  const wById = new Map(nbrs.map((n) => [n.id, n.w]));
  const nodes: GraphNode[] = [
    { id: addr, kind: "address", label: addr.slice(0, 8) + "…", weight: Math.max(...nbrs.map((n) => n.w), 1), center: true, cluster: -1 },
    ...peripheral.map((id) => ({ id, kind: "address" as const, label: id.slice(0, 8) + "…", weight: wById.get(id) ?? 0, cluster: clusterOf.get(id) ?? -1 })),
  ];
  return { nodes, edges: allEdges, stats: { ...stats, peripheral: "neighbours" } };
}

/** One asset's holder cohesion: the asset + its top-N holders, PLUS the interaction edges among the holders.
 *  Independent holders = a diffuse ring around the asset; a sybil/wash cluster = holders wired to each other. */
export async function assetHolders(db: D1Database, asset: string, limit: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats }> {
  const holders = await q<{ holder: string; qty: number }>(
    db,
    `SELECT holder, CAST(quantity_normalized AS REAL) qty FROM balances
     WHERE asset=?1 AND holder_type='address' AND CAST(quantity AS INTEGER)>0
     ORDER BY CAST(quantity AS INTEGER) DESC LIMIT ?2`,
    asset, limit
  );
  const ids = holders.map((h) => h.holder);
  const set = inList(ids);
  const holderEdges = ids.length ? await q<GraphEdge>(db, `SELECT src source, dst target, ROUND(w,3) weight FROM graph_edges WHERE src IN (${set}) AND dst IN (${set})`) : [];
  const { clusterOf, stats } = analyse(ids, holderEdges);
  const nodes: GraphNode[] = [
    { id: asset, kind: "asset", label: asset, weight: holders.length, center: true, cluster: -1 },
    ...holders.map((h) => ({ id: h.holder, kind: "address" as const, label: h.holder.slice(0, 8) + "…", weight: h.qty, cluster: clusterOf.get(h.holder) ?? -1 })),
  ];
  const edges: GraphEdge[] = [
    ...holders.map((h) => ({ source: asset, target: h.holder, weight: h.qty, spoke: true })),
    ...holderEdges,
  ];
  return { nodes, edges, stats: { ...stats, peripheral: "holders" } };
}
