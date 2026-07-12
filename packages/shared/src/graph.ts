/** Graph-reputation trait (Min-k-PPR trust / Anti-TrustRank distrust — see apps/api/docs/graph-reputation.md).
 *  Presented as TIERS, never a continuum: trusted / distrusted / unscored (unscored = no path from the
 *  curated seed circle yet — newcomers and sybils alike; it means "no evidence", not "bad"). */

export type GraphTier = "trusted" | "distrusted" | "unscored";

/** GET /v2/addresses/:address/graph · /v2/assets/:asset/graph */
export interface GraphEntityScore {
  trust: number;
  distrust: number;
  tier: GraphTier;
}

/** Renderable sub-graph (bounded) — GET /v2/graph/address/:a · /v2/graph/asset/:a. Nodes/edges only; the
 *  client lays them out. `weight` is a size hint (in-trust for addresses, holder count / balance otherwise). */
export interface GraphNode {
  id: string;
  kind: "address" | "asset";
  label: string;
  weight: number;
  center?: boolean; // the queried entity, for styling
  cluster?: number; // connected-component id among the peripheral nodes; -1 = independent (no interlinks)
}
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  spoke?: boolean; // center→peripheral (asset↔holder) vs a peripheral↔peripheral interaction edge
}
/** The diagnostic the graph is FOR: how interconnected the peripheral crowd is. High interconnected/largest
 *  relative to total = a coordinated ring (sybil/wash/insider); ~0 = an independent, organic crowd. */
export interface GraphStats {
  peripheral: "holders" | "neighbours";
  total: number; // peripheral node count
  edges_among: number; // interaction edges among the peripheral crowd (excl. the center spokes)
  cohesion: number; // edges_among / total — edges per peripheral node; the headline (organic ≈ <1, ring ≫)
  strong_edges: number; // repeated (heavy-weight) edges — the coordination signal
  interconnected: number; // peripheral nodes in a strong multi-node cluster
  clusters: number; // number of strong multi-node clusters
  largest_cluster: number; // size of the biggest strong cluster
}
export interface GraphSubgraph {
  center: string;
  scope: "address-ego" | "asset-holders";
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}
