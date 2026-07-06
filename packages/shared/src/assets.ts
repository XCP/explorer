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
  // derived (BigInt-exact strings; overrides the raw assets.supply columns)
  supply: string;
  supply_normalized: string | null;
  burned?: string;
  burned_normalized?: string;
  circulating?: string;
  circulating_normalized?: string;
  holder_count: number;
  quality?: AssetQuality;
  tags?: string[];
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
  tiers: Array<{ tier: string; holders: number; pct_supply: number }>;
  archetypes: { creators: number; collectors: number; whales: number };
  top_holder_pct: number | null;
}

/** GET /v2/assets/:asset/market — cross-app market chip from xcpdex (null when it doesn't trade). */
export interface AssetMarket {
  pair: string;
  last_price: number | null;
  volume_7d: number | null;
  trades_7d: number | null;
  price_change_7d: number | null;
}
