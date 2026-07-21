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
  // Supply: XCP only ever mints via burns and destroys via fees/destructions, and every such
  // change is a one-sided row in the 1:1 credit/debit capture — so the running credit−debit sum
  // IS the daily supply curve. Validated against balances (difference = open-order escrow).
  // MATERIALIZED matters: the correlated carry-forward lookup must hit the ~4.6k-row temp, not
  // re-scan the multi-million-row ledger per calendar day.
  return q<PriceHistoryPoint>(
    db,
    `WITH supply_by_day AS MATERIALIZED (
       SELECT day, SUM(delta) OVER (ORDER BY day) / 1e8 supply FROM (
         SELECT date(block.block_time,'unixepoch') day,
           SUM(CASE WHEN ledger.direction=1 THEN CAST(ledger.quantity AS REAL)
             ELSE -CAST(ledger.quantity AS REAL) END) delta
         FROM ledger_events ledger JOIN blocks block ON block.block_index=ledger.block_index
         WHERE ledger.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
         GROUP BY day
       )
     )
     SELECT xcp.day, ROUND(xcp.usd, 6) usd, xcp.source, ROUND(btc.usd, 2) btc,
       ROUND((SELECT s.supply FROM supply_by_day s WHERE s.day<=xcp.day ORDER BY s.day DESC LIMIT 1)) supply,
       /* Total attributable executed volume: on-chain (dex+dispense) + Zaif + Dex-Trade, XCP units. */
       ROUND(COALESCE(market.volume_base,0) + COALESCE(zaif.volume_base,0) + COALESCE(cex.volume_base,0)) vol
     FROM prices xcp
     LEFT JOIN prices btc ON btc.currency='BTC' AND btc.day=xcp.day
     LEFT JOIN market_price_observations market ON market.day=xcp.day
       AND market.source='counterparty' AND market.venue='market'
       AND market.base_currency='XCP' AND market.quote_currency='BTC'
     LEFT JOIN market_price_observations zaif ON zaif.day=xcp.day
       AND zaif.source='zaif' AND zaif.venue='cex'
       AND zaif.base_currency='XCP' AND zaif.quote_currency='JPY'
     LEFT JOIN market_price_observations cex ON cex.day=xcp.day
       AND cex.source='dex-trade' AND cex.venue='cex'
       AND cex.base_currency='XCP' AND cex.quote_currency='BTC'
     WHERE xcp.currency='XCP' ORDER BY xcp.day`,
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
