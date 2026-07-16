/** Established and currently available assets ranked by holder-and-scarcity Conviction. */

/** A scored asset on the radar. `conviction` is the calibrated 0-100 score (higher = stronger holder base +
 *  scarcer float + more network trust); the rest are the components behind it, for the plain-English reason. */
export interface RadarAsset {
  asset: string;
  asset_longname: string | null;
  conviction: number; // Conviction score 0-100
  market_usd: number; // largest realized sale in USD (the market's verdict — low is the point)
  holders: number;
  supply: number; // circulating supply (normalized)
  holder_dex: number; // avg DEX-trade count across holders (holder sophistication)
  creator_pct: number; // % of holders who are proven asset creators (peer validation)
}

/** A radar asset you can buy right now, showing the CHEAPEST path across venues (in USD). Two venues today:
 *  a Counterparty `dispenser` (fixed-price BTC vending — instant buy, no order match) or an `emblem` vault
 *  listed on Ethereum (an aggregated OpenSea/Blur/etc. ask; you buy the wrapped NFT and crack it to redeem
 *  the card). `ask_usd` is always the comparable figure; `ask_btc` is set only for the dispenser venue. */
export interface AvailableAsset extends RadarAsset {
  venue: "dispenser" | "emblem";
  ask_usd: number; // cheapest ask across venues, in USD (the sort/compare figure)
  ask_btc: number | null; // BTC price when venue = dispenser; null for emblem
  marketplace: string | null; // aggregated source when venue = emblem (opensea | blur | …); null for dispenser
  listing_url: string | null; // deep link to the live Ethereum listing (emblem); null for dispenser (act on the asset page)
}

export interface RadarPayload {
  established: RadarAsset[];
  available: AvailableAsset[];
}

/** Observable launch evidence. Counts are frozen at day 30 for Emerging assets. */
export interface EmergenceEvidence {
  asset: string;
  asset_longname: string | null;
  issued_at: number;
  observation_cutoff: number;
  evidence_updated_at: number;
  age_days: number;
  trades: number;
  buyers: number;
  sellers: number;
  active_days: number;
  late_buyers: number;
  late_active_days: number;
  market_span_days: number;
  venues: number;
  fairmints: number;
  minters: number;
  paid_minters: number;
  mint_active_days: number;
  late_minters: number;
  holders: number;
  supply: number;
  top1_pct: number;
  reason: string;
}

export type FreshAsset = EmergenceEvidence;

export interface EmergingAsset extends EmergenceEvidence {
  market_formation: number;
}

export interface AssetEmergencePayload {
  model: "new-radar-2026-07";
  observed_at: number;
  fresh: FreshAsset[];
  emerging: EmergingAsset[];
}
