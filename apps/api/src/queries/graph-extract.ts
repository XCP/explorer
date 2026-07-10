/**
 * Bounded sub-graph extraction for visualization — small, renderable slices of the address interaction graph
 * (graph_edges: directed, weighted src→dst, w = ln(1+interactions)) and the asset↔holder bipartite graph
 * (balances). Everything is capped to a node budget; the full graph (~650k nodes / 1.7M edges) is never
 * returned whole. Separate from queries/graph.ts (reputation scores) — this owns TOPOLOGY, that owns SCORES.
 */
import type { GraphNode, GraphEdge } from "@xcp/shared/graph";
import { q } from "../db";

/** Addresses/assets are base58 / bech32 / uppercase-alnum — safe to inline in an IN(...) list once filtered
 *  to that charset, which sidesteps the bound-variable ceiling when the set is ~80 ids. */
const inList = (ids: string[]) =>
  ids.filter((s) => /^[a-zA-Z0-9._]+$/.test(s)).map((s) => `'${s}'`).join(",") || "''";

/** One address's ego-network: the center + its top-N neighbours by combined edge weight, plus every edge that
 *  runs among that node set (center↔neighbour spokes + neighbour interlinks). Two bounded reads. */
export async function addressEgo(db: D1Database, addr: string, limit: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nbrs = await q<{ id: string; w: number }>(
    db,
    `WITH nbr AS (
       SELECT dst id, w FROM graph_edges WHERE src=?1
       UNION ALL
       SELECT src id, w FROM graph_edges WHERE dst=?1
     )
     SELECT id, ROUND(SUM(w),3) w FROM nbr WHERE id<>?1 GROUP BY id ORDER BY w DESC LIMIT ?2`,
    addr, limit
  );
  const ids = [addr, ...nbrs.map((n) => n.id)];
  const set = inList(ids);
  const edges = await q<GraphEdge>(
    db, `SELECT src source, dst target, ROUND(w,3) weight FROM graph_edges WHERE src IN (${set}) AND dst IN (${set})`);
  const insum = await q<{ id: string; insum: number }>(db, `SELECT id, ROUND(insum,3) insum FROM graph_node WHERE id IN (${set})`);
  const inById = new Map(insum.map((r) => [r.id, r.insum]));
  const nodes: GraphNode[] = ids.map((id) => ({
    id, kind: "address", label: id.slice(0, 8) + "…", weight: inById.get(id) ?? 0, center: id === addr,
  }));
  return { nodes, edges };
}

/** One asset's holder star: the asset node + its top-N address holders, edges weighted by normalized balance.
 *  Bipartite (asset ↔ addresses) — the "who owns this card" picture. */
export async function assetHolders(db: D1Database, asset: string, limit: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const holders = await q<{ holder: string; qty: number }>(
    db,
    `SELECT holder, CAST(quantity_normalized AS REAL) qty FROM balances
     WHERE asset=?1 AND holder_type='address' AND CAST(quantity AS INTEGER)>0
     ORDER BY CAST(quantity AS INTEGER) DESC LIMIT ?2`,
    asset, limit
  );
  const nodes: GraphNode[] = [
    { id: asset, kind: "asset", label: asset, weight: holders.length, center: true },
    ...holders.map((h) => ({ id: h.holder, kind: "address" as const, label: h.holder.slice(0, 8) + "…", weight: h.qty })),
  ];
  const edges: GraphEdge[] = holders.map((h) => ({ source: asset, target: h.holder, weight: h.qty }));
  return { nodes, edges };
}
