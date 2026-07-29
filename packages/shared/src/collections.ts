/** Collection discovery — surfaces that help find and curate collections beyond the tagged directories. */

/** A collection CANDIDATE (GET /v2/collections/candidates): an issuer whose cluster of media assets looks
 *  like a project we haven't tagged yet — judged by who holds it, not by any directory. */
export interface CollectionCandidate {
  issuer: string; // the issuer address the cluster shares
  assets: number; // count of the issuer's uncollected media assets
  avg_holders: number; // mean holders across the cluster
  holder_dex: number; // mean holder DEX-trade sophistication (are real collectors holding it?)
  creator_pct: number; // mean % of holders who are proven creators (peer validation)
  realized_usd: number; // Σ realized value across the cluster (0 = minted-but-never-sold, still interesting)
  score: number; // composite discovery score: holder sophistication × cluster size × creator-heaviness
  samples: string[]; // a few representative member assets (most-held first), for recognition
}

export interface CollectionCandidatesPayload {
  candidates: CollectionCandidate[];
}

/** A descriptive collection profile. These are independent observed axes, not a composite grade. */
export interface CollectionProfile {
  tag: string;
  name: string;
  site: string | null;
  sources: number;
  source_list: string;
  members: number;
  issuers: number;
  rated_members: number;
  rated_pct: number;
  median_rating: number | null;
  rating_exceptional: number;
  rating_strong: number;
  rating_developing: number;
  rating_limited: number;
  market_assets: number;
  market_pct: number;
  total_active_months: number;
  total_paid_buyers: number;
  total_realized_usd: number;
  holder_relationships: number;
  unique_holders: number;
  holder_overlap_pct: number | null;
  top_asset_value_pct: number | null;
  integrity_assets: number;
  integrity_pct: number;
}

/** One persona bucket of a collection's holder base (holder-makeup `personas[]`). */
export type CollectionPersonaRow = { persona: string; holders: number };

/** GET /v2/collection-profiles/:tag/holder-makeup — every current holder of every member asset,
 *  classified by global address persona (the same classifier the address reputation header uses).
 *  `light` = holds but clears no persona floor; `service` = exchange/deposit/vault/burn custody. */
export interface CollectionHolderMakeup {
  tag: string;
  holders: number;
  personas: CollectionPersonaRow[];
}
