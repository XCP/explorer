/** Collection discovery — surfaces that help find and curate collections beyond the tagged directories. */

/** A collection CANDIDATE (GET /v2/collections/candidates): an issuer whose cluster of media assets looks
 *  like a project we haven't tagged yet — judged by who holds it, not by any directory. */
export interface CollectionCandidate {
  issuer: string;        // the issuer address the cluster shares
  assets: number;        // count of the issuer's uncollected media assets
  avg_holders: number;   // mean holders across the cluster
  holder_dex: number;    // mean holder DEX-trade sophistication (are real collectors holding it?)
  creator_pct: number;   // mean % of holders who are proven creators (peer validation)
  realized_usd: number;  // Σ realized value across the cluster (0 = minted-but-never-sold, still interesting)
  score: number;         // composite discovery score: holder sophistication × cluster size × creator-heaviness
  samples: string[];     // a few representative member assets (most-held first), for recognition
}

export interface CollectionCandidatesPayload {
  candidates: CollectionCandidate[];
}
