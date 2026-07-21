/** The explorer's own XCP price surface — GET /v2/price (the /price page payload) and
 *  GET /v2/price/ticker (the header's tiny quote). Every figure comes from the reviewed daily
 *  calendar the explorer already uses to value trades; provenance travels with the number. */

export interface PriceTicker {
  as_of: number;
  xcp: { usd: number; change_pct: number | null } | null;
  btc: { usd: number; change_pct: number | null } | null;
}

export interface PriceQuote {
  day: string;
  usd: number;
  source: string;
  price_kind: string;
  observed_day: string | null;
  selection_reason: string | null;
}

export interface PriceHistoryPoint {
  day: string;
  usd: number;
  source: string;
  /** Same-day BTC/USD from the calendar — lets clients denominate in sats or index vs BTC. */
  btc?: number | null;
  /** XCP supply as of this day (whole units), cumulated from the 1:1 credit/debit ledger — burns
   *  grew it, fees and destructions shrink it. Includes escrowed coins. */
  supply?: number | null;
  /** Total ATTRIBUTABLE executed XCP volume this day (XCP units): on-chain DEX + dispenses, plus
   *  Zaif and Dex-Trade execution volume where observed. null = no attributable executions. */
  vol?: number | null;
}

export interface PriceSourceEra {
  source: string;
  days: number;
  first_day: string;
  last_day: string;
}

/** Last-30-day on-chain XCP/BTC execution evidence, per venue (dex / dispense / market combined). */
export interface PriceVenueEvidence {
  venue: string;
  days: number;
  fills: number;
  volume_xcp: number;
  last_day: string | null;
}

export interface PricePage {
  as_of: number;
  xcp: PriceQuote | null;
  btc: PriceQuote | null;
  change_pct: number | null;
  /** The latest combined on-chain XCP/BTC edge — the chain-native price, in BTC per XCP. */
  sats: { price_btc: number; day: string; trades: number | null } | null;
  ath: PriceHistoryPoint | null;
  history: PriceHistoryPoint[];
  sources: PriceSourceEra[];
  venues_30d: PriceVenueEvidence[];
}
