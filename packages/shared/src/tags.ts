/** Tag scores — the derivative "tag scores" layer: per-tag aggregate asset/address scores (collection
 *  scoreboards + cohort stats). Asset tags carry composed-quality aggregates; address tags carry counts
 *  only (score stats null). Mirror: apps/api/src/read/tags.ts + queries/tags.ts. */

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
  mean_raw: number | null; // mean composed-quality raw over asset members
  median_raw: number | null; // median composed-quality raw over asset members
  median_score: number | null; // 0-100 percentile of median_raw (enriched server-side)
  median_tier: string | null; // assetTier(median_raw) — the collection's headline tier (enriched server-side)
  pct_low_quality: number | null; // % of asset members flagged low_quality
  total_realized_usd: number; // Σ max_realized_usd over asset members
  total_holders: number; // Σ holders over asset members
}

/** One asset member of a tag (GET /v2/tags/:tag members[]). Tier + score are computed server-side from
 *  the same composed raw the asset detail endpoint uses (assetTier incl. the low_quality cap). */
export interface TagMemberRow {
  asset: string;
  asset_longname: string | null;
  holders: number;
  buyers: number; // distinct realized-value counterparties (distinct_traders + distinct_dispense_buyers)
  max_realized_usd: number;
  raw: number; // composed-quality raw (validation expr)
  score: number | null; // 0-100 percentile among market assets (null if the asset has no market)
  tier: string; // assetTier() incl. the low_quality cap
  low_quality: 0 | 1;
}

/** GET /v2/tags/:tag — the aggregate header (TagStatsRow) + a page of asset members. Envelope carries
 *  next_offset (null-terminated); the aggregate repeats on every page (like the other paginated details). */
export interface TagDetail extends TagStatsRow {
  members: TagMemberRow[];
}
