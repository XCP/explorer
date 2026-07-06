/** Graph-reputation trait (Min-k-PPR trust / Anti-TrustRank distrust — see apps/api/docs/graph-reputation.md).
 *  Presented as TIERS, never a continuum: trusted / distrusted / unscored (unscored = no path from the
 *  curated seed circle yet — newcomers and sybils alike; it means "no evidence", not "bad"). */

export type GraphTier = "trusted" | "distrusted" | "unscored";

/** GET /v2/addresses/:addr/graph · /v2/assets/:asset/graph */
export interface GraphEntityScore {
  trust: number;
  distrust: number;
  tier: GraphTier;
}
