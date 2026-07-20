/**
 * Year-in-review pages ("Counterparty Unwrapped", /year/[year]) — the wire contract for
 * GET /v2/years (index) and GET /v2/years/:year (page). Computed figures come from the mirror;
 * `editorial` is authored catalog content. Research provenance: docs/year-unwrapped.md.
 */

export interface YearOhlc {
  open: number;
  close: number;
  high: number;
  low: number;
  change_pct: number;
}

export interface YearSummary {
  year: number;
  /** Only the current (in-progress) year; partial years hold no records. */
  partial: boolean;
  transactions: number;
  actors: number;
  newcomers: number;
  new_assets: number;
  issuers: number;
  dex_fills_raw: number;
  dex_usd_raw: number;
  clean_fills: number;
  clean_usd: number;
  xcp: YearOhlc | null;
  btc: YearOhlc | null;
  /** Record keys this COMPLETED year holds across the whole index (e.g. "dex_fills_raw"). */
  records: string[];
}

export interface YearIndex {
  as_of: number;
  years: YearSummary[];
}

export interface YearStats {
  transactions: number;
  actors: number;
  newcomers: number;
  newcomer_pct: number;
  new_assets: number;
  issuers: number;
  subassets: number;
  sends: number;
  supply_locks: number;
  ownership_transfers: number;
  dex_fills_raw: number;
  dex_usd_raw: number;
  clean_fills: number;
  clean_usd: number;
}

export interface YearMonth {
  month: number;
  clean_fills: number;
  clean_usd: number;
  new_assets: number;
}

export interface YearVenue {
  venue: string;
  fills: number;
  usd: number;
}

export interface YearSettlement {
  currency: string;
  fills: number;
  usd: number | null;
}

export interface YearTopAsset {
  asset: string;
  asset_longname: string | null;
  fills: number;
  usd: number;
}

export interface YearSale {
  asset: string;
  usd: number;
  day: string;
  currency: string;
  venue: string;
  quantity: number;
}

export interface YearCollection {
  tag: string;
  name: string;
  cards: number;
}

export interface YearCard {
  asset: string;
  usd: number;
  fills: number;
  tag: string;
}

export interface YearZaif {
  days: number;
  xcp_volume: number;
  usd: number;
}

/** The proof-of-burn founding event — non-null only for 2014. */
export interface YearBurn {
  burns: number;
  burners: number;
  btc_burned: number;
  xcp_earned: number;
  first_day: string;
  last_day: string;
}

export interface YearProtocolEvent {
  date: string;
  name: string;
  note: string;
}

export interface YearMoment {
  label: string;
  text: string;
}

export interface YearEditorial {
  title: string;
  angle: string;
  moments: YearMoment[];
  graffiti: { day: string; text: string } | null;
  meanwhile: string[];
  lexicon: string[];
}

export interface YearPage {
  year: number;
  partial: boolean;
  as_of: number;
  editorial: YearEditorial;
  stats: YearStats;
  scoreboard: {
    xcp: YearOhlc | null;
    btc: YearOhlc | null;
    pepecash: { first_vwap: number; last_vwap: number; change_pct: number } | null;
  };
  /** ["2017-01-01", 1.92] daily closes for the hero chart. */
  xcp_daily: [string, number][];
  monthly: YearMonth[];
  venues: YearVenue[];
  settlement: YearSettlement[];
  top_assets: YearTopAsset[];
  /** Biggest single clean fill by a collection member (cards) and by a non-member (coins). */
  sale_of_year: YearSale | null;
  currency_sale_of_year: YearSale | null;
  burn: YearBurn | null;
  collections: YearCollection[];
  cards: YearCard[];
  zaif: YearZaif | null;
  protocol: YearProtocolEvent[];
}
