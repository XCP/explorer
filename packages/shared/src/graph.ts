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
}
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}
export interface GraphSubgraph {
  center: string;
  scope: "address-ego" | "asset-holders";
  nodes: GraphNode[];
  edges: GraphEdge[];
}
