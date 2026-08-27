/** The explorer's own XCP price surface — GET /v2/price (the historical /price payload) and
 *  GET /v2/price/ticker (the current header quote). Historical figures come from the reviewed
 *  daily calendar; the live XCP quote uses the cheapest confirmed, fillable one-XCP dispenser. */

export interface PriceTicker {
  as_of: number;
  xcp: {
    usd: number;
    change_pct: number | null;
    /** Current confirmed one-XCP dispenser ask. Null when the daily reference is the fallback. */
    sats: number | null;
    quote: "confirmed_unit_dispenser_ask" | "daily_reference";
  } | null;
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

/** One daily candle of the on-chain XCP/BTC tape, every price in BTC per XCP. The close is the
 *  day's volume-weighted median — the same edge the USD calendar consumes. The wick ends are
 *  volume-weighted 5th/95th percentile prices over the fills within 10× of that median, so a
 *  mispriced dispenser print reads as dispersion, never as a fantasy extreme. Volume and fills
 *  count the WHOLE day. The open is the previous candle's close, drawn client-side. */
export interface PriceCandlePoint {
  day: string;
  low: number;
  close: number;
  high: number;
  /** Executed XCP volume behind this candle. */
  volume: number;
  fills: number;
  /** Same-day BTC/USD from the calendar — lets clients draw the USD denomination. */
  btc: number | null;
}

/** GET /v2/price/ohlc — the /price page's TradingView-style tape, on-chain executions only. */
export interface PriceCandles {
  as_of: number;
  candles: PriceCandlePoint[];
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
