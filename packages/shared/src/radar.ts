/** Radar — the "undervalued grail" surface (GET /v2/radar). Ranks assets by CONVICTION (who holds it +
 *  how scarce, orthogonal to the market) where realized value is low: what the smart money holds that the
 *  market hasn't priced yet. Every row carries its own components so the UI can state the reason plainly. */

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
export interface BuyableAsset extends RadarAsset {
  venue: "dispenser" | "emblem";
  ask_usd: number; // cheapest ask across venues, in USD (the sort/compare figure)
  ask_btc: number | null; // BTC price when venue = dispenser; null for emblem
  marketplace: string | null; // aggregated source when venue = emblem (opensea | blur | …); null for dispenser
  listing_url: string | null; // deep link to the live Ethereum listing (emblem); null for dispenser (act on the asset page)
}

export interface RadarPayload {
  undervalued: RadarAsset[]; // high Conviction, low realized price — the discovery watchlist
  buyable: BuyableAsset[]; // high Conviction + an open dispenser right now — the actionable cut
}
