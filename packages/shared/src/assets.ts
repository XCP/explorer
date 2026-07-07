/** Asset surfaces — detail, quality, holders (GET /v2/assets/:asset and its sub-reads). */

export type AssetQualityTier =
  | "Bluechip" | "Established" | "Active" | "Speculative" // ranked (has a market)
  | "Untraded" | "Dormant"; // non-ranked states

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
  last_sale_usd: number | null; // the most recent USD-known sale
  last_sale_time: number | null; // unix seconds of that sale
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
  circulating?: string;
  circulating_normalized?: string;
  holder_count: number;
  quality?: AssetQuality;
  tags?: string[];
  sales?: AssetSales;
  collection?: string | null; // curated collection tag (tags.source='collection'), e.g. "rare-pepe" // absent on the native XCP/BTC reduced path
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

/** GET /v2/assets/:asset/cohort — "holders of X also collect…" ranked by shared-holder count. */
export interface AssetCohortRow {
  asset: string;
  asset_longname: string | null;
  shared: number;
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

/** Balance rows. Two read shapes share this:
 *   - GET /v2/addresses/:a/balances → asset/quantity + divisible/asset_longname/stamp
 *   - GET /v2/assets/:a/balances    → holder/holder_type/quantity + is_burn/is_exchange
 *  Fields not selected by a given endpoint are simply absent (hence optional). Mirror: balances. */
export interface BalanceRow {
  asset: string;
  quantity: string; // raw bigint as text
  quantity_normalized: string | null;
  // asset-scoped (holders of an asset)
  holder?: string;
  holder_type?: "address" | "utxo";
  is_burn?: 0 | 1;
  is_exchange?: 0 | 1;
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
  n: number; mean: number; max: number; min: number; top1pct: number; top10pct: number;
}

/** GET /v2/reputation/asset-review — a top-20-by-raw-quality row (face-validity check). */
export interface AssetReviewTopRow {
  asset: string; asset_longname: string | null; holders: number; trades: number; raw: number;
}

/** GET /v2/assets/:asset/market — cross-app market chip from xcpdex (null when it doesn't trade). */
export interface AssetMarket {
  pair: string;
  last_price: number | null;
  volume_7d: number | null;
  trades_7d: number | null;
  price_change_7d: number | null;
}
