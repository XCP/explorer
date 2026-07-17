/** Tag profiles: categorical membership plus descriptive aggregate Rating and holder evidence. */

/** GET /v2/tags — one row per distinct tag (population aggregate). Score stats (mean/median/tier/USD/
 *  holders) are computed over the tag's ASSET members via the same raw expr the validation endpoint uses;
 *  they are null/0 for pure address tags (which report n_addresses instead). */
export interface TagStatsRow {
  tag: string;
  entity_type: "asset" | "address";
  source: string; // computed | protocol | curated | collection | media | manual
  n: number; // total members
  n_assets: number;
  n_addresses: number;
  mean_rating: number | null;
  median_rating: number | null;
  pct_low_quality: number | null; // % of asset members flagged low_quality
  total_realized_usd: number; // Σ max_realized_usd over asset members
  total_holders: number; // Σ holders over asset members
  // Community-strength aggregates — the per-asset "who holds it" signals rolled up to the collection.
  avg_conviction: number | null; // mean Conviction raw over members (low_quality members zeroed)
  conviction_score: number | null; // 0-100 (enriched server-side) — the collection's community/scarcity strength
  avg_holder_dex: number | null; // mean holder DEX-trade sophistication across members
  avg_creator_pct: number | null; // mean % of members' holders who are proven creators (peer validation)
  meta: string | null; // collection meta JSON ({collection, site}) when the tag carries one (tokenscan)
}

/** One asset member of a tag (GET /v2/tags/:tag members[]). */
export interface TagMemberRow {
  asset: string;
  asset_longname: string | null;
  holders: number;
  buyers: number; // distinct realized-value counterparties (distinct_traders + distinct_dispense_buyers)
  max_realized_usd: number;
  rating: number | null;
  low_quality: 0 | 1;
}

/** GET /v2/tags/:tag — the aggregate header (TagStatsRow) + a page of asset members. Envelope carries
 *  next_offset (null-terminated); the aggregate repeats on every page (like the other paginated details). */
export interface TagDetail extends TagStatsRow {
  members: TagMemberRow[];
}
