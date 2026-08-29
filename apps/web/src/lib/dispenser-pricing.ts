/**
 * What one dispense actually costs. An ordinary dispenser charges `satoshirate` satoshis. An oracle
 * dispenser instead stores fiat CENTS in `satoshirate` and settles at its oracle's latest valid
 * broadcast — counterparty-core computes `must_give = floor(btc_paid × oracle_price / (satoshirate/100))`
 * with no staleness check — so the BTC price moves with the feed, and a dead feed pins it.
 */
export interface DispenserQuote {
  satoshirate: string | null;
  oracle_address: string | null;
  oracle_price: number | null;
  oracle_price_block_time: number | null;
  oracle_fiat: string | null;
}

/** Satoshis one dispense costs at the current quote; null when an oracle dispenser has no usable price. */
export function dispenseSats(d: DispenserQuote): number | null {
  const rate = Number(d.satoshirate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!d.oracle_address) return rate;
  if (d.oracle_price == null || !(d.oracle_price > 0)) return null;
  return Math.ceil((rate / 100 / d.oracle_price) * 1e8);
}

/** The fiat sticker an oracle dispenser was priced in ("$70.00 USD"); null for a BTC-priced dispenser. */
export function oracleFace(d: DispenserQuote): { amount: number; fiat: string } | null {
  if (!d.oracle_address) return null;
  const rate = Number(d.satoshirate);
  return Number.isFinite(rate) ? { amount: rate / 100, fiat: d.oracle_fiat || "fiat" } : null;
}

/** An oracle quote older than this is flagged — the feed behind every mainnet oracle dispenser went silent in 2024. */
export const ORACLE_STALE_AFTER_SECONDS = 30 * 86400;

export function oracleQuoteStale(d: DispenserQuote, now = Date.now() / 1000): boolean {
  return (
    !!d.oracle_address &&
    d.oracle_price_block_time != null &&
    now - d.oracle_price_block_time > ORACLE_STALE_AFTER_SECONDS
  );
}
