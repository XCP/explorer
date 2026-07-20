/** The unified cross-venue sales ledger (GET /v2/trades and per-asset history). */

/** One row per sale across every venue — DEX order-matches, dispenses, Emblem-vault NFT sales. */
export interface TradeRow {
  venue: "dex" | "dispense" | "emblem" | string;
  asset: string | null; // the Counterparty card (null if unattributable)
  block_time: number | null;
  block_index: number | null; // Counterparty block, or ETH block_number for Emblem
  quantity: number | null;
  currency: "XCP" | "BTC" | "ETH" | "USDC" | string | null;
  total: number | null; // in `currency` units
  price: number | null; // generated: total/quantity
  usd_value: number | null; // historical payment value; never substituted with a current quote
  usd_basis: "execution_day" | "direct_usd" | null;
  usd_source: string | null;
  usd_price_day: string | null;
  usd_observed_day: string | null;
  low_quality: 0 | 1;
  buyer: string | null;
  seller: string | null;
  tx_hash: string | null;
  sale_class: "single" | "bundle" | string | null;
  leg_count: number;
  source_name: string | null;
  source_url: string | null;
}

/** One ring-trade review candidate (GET /v2/trades/ring-candidates returns Envelope<RingCandidate[]>).
 *  Surfaces assets whose priced volume concentrates in RECIPROCAL address pairs (A sells B, B sells A)
 *  — the wash pattern that literal self-fill exclusion cannot see. Review evidence, never an auto-flag. */
export interface RingCandidate {
  asset: string;
  usd: number; // total priced two-party USD across venues
  fills: number;
  recip_usd: number; // matched two-way USD: 2*MIN(A->B, B->A) summed over pairs
  recip_fills: number;
  recip_pct: number; // recip_usd / usd, 0-100
  participants: number; // distinct addresses on either side of any priced trade
  top_pair_usd: number; // the busiest reciprocal pair's combined USD
  top_pair_fills: number;
  top_pair_a: string; // its two addresses
  top_pair_b: string;
}

/** One venue's totals (GET /v2/trades/stats returns Envelope<TradeVenueStats[]>). */
export interface TradeVenueStats {
  venue: string;
  trades: number;
  assets: number; // distinct Counterparty assets sold on this venue
  last_time: number | null; // unix seconds of the most recent trade
  usd_known: number | null; // SUM(usd_value) over rows where USD is known
  usd_unpriced_trades: number;
  low_quality_trades: number;
}
