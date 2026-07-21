/**
 * Read-side price queries — the SQL behind GET /v2/price and /v2/price/ticker. The `prices` daily
 * calendar and `market_price_observations` are BUILT by indexer/prices.ts; this file only reads
 * them for display, provenance included.
 */
import type { PriceHistoryPoint, PriceQuote, PriceSourceEra, PriceVenueEvidence } from "@xcp/shared/prices";
import { one, q } from "#api/db";

export function latestPrice(db: D1Database, currency: string): Promise<PriceQuote | null> {
  return one<PriceQuote>(
    db,
    `SELECT day, usd, source, price_kind, observed_day, selection_reason
     FROM prices WHERE currency=?1 ORDER BY day DESC LIMIT 1`,
    currency,
  );
}

export function priceBefore(db: D1Database, currency: string, day: string): Promise<{ usd: number } | null> {
  return one<{ usd: number }>(
    db,
    `SELECT usd FROM prices WHERE currency=?1 AND day<?2 ORDER BY day DESC LIMIT 1`,
    currency,
    day,
  );
}

export function xcpHistory(db: D1Database): Promise<PriceHistoryPoint[]> {
  return q<PriceHistoryPoint>(
    db,
    `SELECT day, ROUND(usd, 6) usd, source FROM prices WHERE currency='XCP' ORDER BY day`,
  );
}

export function xcpSourceEras(db: D1Database): Promise<PriceSourceEra[]> {
  return q<PriceSourceEra>(
    db,
    `SELECT source, COUNT(*) days, MIN(day) first_day, MAX(day) last_day
     FROM prices WHERE currency='XCP' GROUP BY source ORDER BY MIN(day)`,
  );
}

/** The latest combined on-chain XCP/BTC edge — the chain-native price the USD cross-rate consumes. */
export function latestMarketEdge(
  db: D1Database,
): Promise<{ price_btc: number; day: string; trades: number | null } | null> {
  return one<{ price_btc: number; day: string; trades: number | null }>(
    db,
    `SELECT price price_btc, day, trades FROM market_price_observations
     WHERE source='counterparty' AND venue='market' AND base_currency='XCP' AND quote_currency='BTC'
     ORDER BY day DESC LIMIT 1`,
  );
}

export function onChainVenueEvidence(db: D1Database, sinceDay: string): Promise<PriceVenueEvidence[]> {
  return q<PriceVenueEvidence>(
    db,
    `SELECT venue, COUNT(*) days, COALESCE(SUM(trades),0) fills,
       ROUND(COALESCE(SUM(volume_base),0)) volume_xcp, MAX(day) last_day
     FROM market_price_observations
     WHERE source='counterparty' AND base_currency='XCP' AND quote_currency='BTC'
       AND venue IN ('dex','dispense') AND day>=?1
     GROUP BY venue ORDER BY venue`,
    sinceDay,
  );
}
