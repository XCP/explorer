/** Asset surfaces — detail, quality, holders (GET /v2/assets/:asset and its sub-reads). */

export type AssetQualityTier =
  | "Bluechip"
  | "Premium"
  | "Notable"
  | "Speculative" // ranked (has a market) — the asset RATING ladder
  | "Untraded"
  | "Dormant"; // non-ranked states

/** Composed quality object on AssetDetail. Non-ranked assets get just { tier, score: null }. */
export interface AssetQuality {
  tier: AssetQualityTier | string;
  score: number | null; // 0-100 percentile among market assets only
  raw?: number;
  breakdown?: Record<string, number>; // per-factor contribution (label → points)
  low_quality?: boolean;
}

/** Per-asset money stats from the unified trades ledger (AssetDetail.sales). */
export interface AssetSales {
  realized_usd: number | null; // lifetime SUM(usd_value) across every venue
  last_price_usd: number | null; // per-unit USD price of the most recent USD-known sale (usd_value ÷ quantity)
  last_sale_time: number | null; // unix seconds of that sale
}

/** Per-feed record counts on AssetDetail (feed_counts) — one count per detail-page feed tab, each
 *  computed with the SAME filter as that tab's list endpoint so the numbers match the tables. */
export interface AssetFeedCounts {
  sales: number; // trades ledger rows (every venue)
  issuances: number;
  dispensers: number;
  dispenses: number;
  orders: number; // orders touching the asset on either side
  sends: number;
  subassets: number;
  from_issuer: number; // assets the issuer issued or owns (the from-issuer feed)
  fairmints: number;
  dividends: number; // dividends touching the asset on either side (paid ON it, or paid IN it)
  destructions: number;
  pools: number; // AMM pools the asset participates in (either reserve leg, or as the LP token)
}

/** GET /v2/assets/:asset — full assets row + derived supply/burned/circulating + quality + tags.
 *  Native XCP/BTC take a reduced path, so many issuance fields are optional. Mirror: assets. */
export interface AssetDetail {
  asset: string;
  asset_longname: string | null;
  asset_id?: string | null;
  type: string; // native | numeric | subasset | asset
  issuer: string | null;
  owner: string | null;
  divisible: 0 | 1;
  locked: 0 | 1;
  description_locked?: 0 | 1;
  description: string | null;
  mime_type?: string | null;
  first_issuance_block_index?: number | null;
  last_issuance_block_index?: number | null;
  first_issuance_block_time?: number | null;
  last_issuance_block_time?: number | null;
  updated_at?: number;
  // derived (BigInt-exact strings; overrides the raw assets.supply columns).
  // supply is ABSENT on the native XCP/BTC reduced path — hence optional.
  supply?: string;
  supply_normalized: string | null;
  burned?: string;
  burned_normalized?: string;
  // escrow = supply locked in open dispensers + open DEX orders (debited from balances, held by no address)
  escrow?: string;
  escrow_normalized?: string;
  circulating?: string;
  circulating_normalized?: string;
  holder_count: number;
  quality?: AssetQuality;
  tags?: string[];
  sales?: AssetSales;
  collection?: string | null; // collection tag (pepe.wtf source='collection' or tokenscan), e.g. "rare-pepe" // absent on the native XCP/BTC reduced path
  collection_site?: string | null; // project site when the collection came from the tokenscan directory (its meta.site)
  collection_series?: number | null; // pepe.wtf series number within the collection (e.g. Rare Pepe Series 1–36)
  collection_card?: number | null; // pepe.wtf card number within the series (the canonical ordinal position)
  artist?: { tag: string; name: string; slug: string } | null; // pepe.wtf artist; `tag` is the /tags/<artist-slug> route
  feed_counts?: AssetFeedCounts | null; // per-feed tab counts; null when the count read failed
  cohesion?: AssetCohesion | null; // holder-cohesion coordination signal; null until the batch has scored this asset
  conviction?: AssetConviction | null; // who-holds-it + scarcity score; null when the asset isn't in the grail-shaped population
}

/** Conviction — WHO holds the asset + how scarce it is, with ZERO market/volume inputs (the Radar signal, on
 *  the asset itself). Only computed for the same grail-shaped population Radar ranks (real, network-trusted,
 *  ≥15 holders, named), so the number always means the same thing in both places. `undervalued` mirrors
 *  Radar's dislocation cut: top-decile conviction while realized value is still under its threshold. */
export interface AssetConviction {
  score: number; // 0-100 (percentile against the scored population)
  undervalued: boolean; // high conviction, unpriced market — the dislocation read
}

/** Holder cohesion — interaction edges among the asset's top holders ÷ holder count. Among traded assets the
 *  median sits ~4 (active traders are interconnected in the graph's giant component), so the score is only
 *  interesting in the tail. `insular` flags the market-integrity case only: a top-decile insular holder base
 *  (score ≥ 9, holders trade mostly among themselves) that ALSO carries real realized volume (≥$1k) — i.e. the
 *  wash / inflated-volume suspect. A $0-volume insular base (a harmless airdrop cohort) is not flagged. */
export interface AssetCohesion {
  score: number; // edges ÷ holders (2 decimals)
  edges: number; // raw interaction edges among the top holders
  strong: number; // of those, edges with ~4+ repeated interactions
  insular: boolean; // insular top-decile holder base WITH real volume — inflated-volume suspect
}

/** GET /v2/assets — the asset index / search row. description is clamped to a single line server-side
 *  (full text is on the detail endpoint); mime_type is omitted; stamp is a computed EXISTS flag. */
export interface AssetIndexRow {
  asset: string;
  asset_longname: string | null;
  type: string; // native | numeric | subasset | asset
  issuer: string | null;
  owner: string | null;
  divisible: 0 | 1;
  locked: 0 | 1;
  supply_normalized: string | null;
  description: string | null; // truncated to ~140 chars
  stamp: 0 | 1;
  first_issuance_block_time: number | null;
  last_issuance_block_index: number | null;
}

/** GET /v2/featured — the curated media grid: top-quality market assets that have art. */
export interface FeaturedAsset {
  asset: string;
  asset_longname: string | null;
  score: number;
}

/** GET /v2/assets/:asset/activity — one row per month of the asset's on-chain life, from our own mirror.
 *  Every event kind is counted and rolled into the four mediums people think in. Monthly (not daily) keeps
 *  the payload tiny — the chart buckets monthly anyway. Powers the Activity tab time-series. */
export interface AssetActivityMonth {
  month: string; // YYYY-MM
  orders: number; // DEX: order matches + orders opened
  dispensers: number; // BTC: dispenses + dispensers opened
  sends: number; // plain transfers
  supply: number; // issuances + fairmints + destructions + dividends
}

/** GET /v2/assets/:asset/enhanced — CIP-25 enhanced asset info. When the on-chain description points to a
 *  JSON file, the API fetches it server-side (CORS-free), caps it, and verifies the optional `;sha256` hash;
 *  the client renders + sanitizes it. `json` is the raw CIP-25 object; `verified` = the hash matched. */
export interface AssetEnhanced {
  json?: Record<string, unknown>;
  url?: string;
  verified?: boolean;
  error?: string;
}

/** GET /v2/assets/:asset/active-users — addresses ranked by lifetime credits + debits of the asset: who has
 *  USED it the most (moved it in/out), independent of current balance. Backed by the credits/debits ledger. */
export interface AssetActiveUser {
  address: string;
  credits: number; // times the asset was credited to this address
  debits: number; // times it was debited from this address
  activity: number; // credits + debits
}

/** GET /v2/assets/:asset/cohort — "holders of X also collect…" ranked by shared-holder count. */
export interface AssetCohortRow {
  asset: string;
  asset_longname: string | null;
  shared: number; // holders of the subject asset that also hold this one
  pct?: number | null; // `shared` as % of the subject asset's holders — the "why it's related" figure
}

/** GET /v2/assets/:asset/related — the Related tab's two strips, each row carrying its co-hold reason
 *  (`pct`% of the subject's holders also hold it). `collection` = same-collection siblings ranked by that
 *  overlap; `cohort` = the broadest co-held assets outside the collection. */
export interface AssetRelated {
  collection: AssetCohortRow[];
  cohort: AssetCohortRow[];
}

/** Asset-list rows (GET /v2/addresses/:a/issued, /v2/assets/:a/subassets, from-issuer). */
export interface AssetListRow {
  asset: string;
  asset_longname: string | null;
  divisible: 0 | 1;
  locked: 0 | 1;
  issuer: string | null;
  first_issuance_block_index: number | null;
}

/** The single most-specific classification of an asset holder, for the holders-table badge. Custody
 *  labels win over behavior; behavior buckets are mutually exclusive by threshold. Absent = plain holder. */
export type HolderRole = "burn" | "exchange" | "vault" | "deposit" | "service" | "creator" | "whale" | "collector";

/** Balance rows. Two read shapes share this:
 *   - GET /v2/addresses/:a/balances → asset/quantity + divisible/asset_longname/stamp
 *   - GET /v2/assets/:a/balances    → holder/holder_type/quantity + role
 *  Fields not selected by a given endpoint are simply absent (hence optional). Mirror: balances. */
export interface BalanceRow {
  asset: string;
  quantity: string; // raw bigint as text
  quantity_normalized: string | null;
  // asset-scoped (holders of an asset)
  holder?: string;
  holder_type?: "address" | "utxo";
  role?: HolderRole | null;
  // address-scoped (an address's holdings)
  divisible?: 0 | 1 | null;
  asset_longname?: string | null;
  stamp?: 0 | 1;
}

/** GET /v2/assets/:asset/quality — the "is this cap table real?" read. */
export interface AssetQualityReport {
  holders: number;
  top1_pct?: number;
  trades: number;
  self_trade_pct?: number;
  holder_breadth?: number;
  pct_creator_holders?: number;
  burned_pct?: number;
  low_quality: 0 | 1;
  wash_suspect?: boolean;
}

/** GET /v2/assets/:asset/holder-makeup — holder base by reputation tier + archetypes + concentration. */
export interface AssetHolderMakeup {
  asset: string;
  holders: number;
  tiers: HolderTierRow[];
  archetypes: { creators: number; collectors: number; whales: number };
  top_holder_pct: number | null;
}

/** One reputation-tier bucket of an asset's holder base (holder-makeup `tiers[]`). */
export type HolderTierRow = { tier: string; holders: number; pct_supply: number };

/** Archetype counts among an asset's holders (holder-makeup source; `holders` is the total). */
export type HolderArchetypes = { creators: number; whales: number; collectors: number; holders: number };

/** GET /v2/reputation/asset-review — population quality distribution over asset_signals. */
export interface AssetReviewDistribution {
  n: number;
  mean: number;
  max: number;
  min: number;
  top1pct: number;
  top10pct: number;
}

/** GET /v2/reputation/asset-review — a top-20-by-raw-quality row (face-validity check). */
export interface AssetReviewTopRow {
  asset: string;
  asset_longname: string | null;
  holders: number;
  trades: number;
  raw: number;
}

/** GET /v2/assets/:asset/market — cross-app market chip from xcpdex (null when it doesn't trade). */
export interface AssetMarket {
  pair: string;
  last_price: number | null;
  volume_7d: number | null;
  trades_7d: number | null;
  price_change_7d: number | null;
  floor_usd: number | null; // lowest open ask converted to USD — the header "Floor price"
  floor_source: string | null; // where the floor came from ("Order")
}
