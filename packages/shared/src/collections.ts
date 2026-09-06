/** Collection discovery — surfaces that help find and curate collections beyond the tagged directories. */

/** A collection CANDIDATE (GET /v2/collections/candidates): an untagged asset the collector base has
 *  already chosen — ranked by collector-persona holders who acquired it by CHOICE (a trade, a
 *  dispense, or a send from anyone but the asset's dominant distributor), so an airdrop blast cannot
 *  manufacture its way onto the board. */
export interface CollectionCandidate {
  asset: string;
  asset_longname: string | null;
  issuer: string | null; // for recognition and grouping by eye
  chosen_collectors: number; // collector-persona holders with a chosen acquisition path — the rank
  collector_holders: number; // all collector-persona holders (airdrops inflate this; the gap is the tell)
  holders: number | null; // the whole holder base
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

/** GET /v2/addresses/collections?addresses=a,b,c — which curated collections each requested address
 *  created cards in (the source of a member asset's first valid issuance). Up to 50 addresses per call;
 *  addresses that created nothing are omitted. `cards` counts that address's cards in that collection. */
export interface AddressCollectionCreator {
  address: string;
  collections: { tag: string; cards: number }[];
}
