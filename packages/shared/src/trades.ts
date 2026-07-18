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
  usd_value: number | null; // filled where known (USDC at ingest; backfill via prices)
  buyer: string | null;
  seller: string | null;
  tx_hash: string | null;
  sale_class: "single" | "bundle" | string | null;
  leg_count: number;
}

/** One venue's totals (GET /v2/trades/stats returns Envelope<TradeVenueStats[]>). */
export interface TradeVenueStats {
  venue: string;
  trades: number;
  assets: number; // distinct Counterparty assets sold on this venue
  last_time: number | null; // unix seconds of the most recent trade
  usd_known: number | null; // SUM(usd_value) over rows where USD is known
}
