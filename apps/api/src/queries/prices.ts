/**
 * Read-side price queries — the SQL behind GET /v2/price and /v2/price/ticker. The `prices` daily
 * calendar and `market_price_observations` are BUILT by indexer/prices.ts; this file only reads
 * them for display, provenance included.
 */
import type {
  PriceCandlePoint,
  PriceHistoryPoint,
  PriceQuote,
  PriceSourceEra,
  PriceVenueEvidence,
} from "@xcp/shared/prices";
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

/**
 * The cheapest confirmed XCP dispenser that can vend one whole XCP right now.
 *
 * This intentionally matches the actionable unit-dispenser market shown by the buy-XCP UI:
 * odd-sized and bulk-only lots are different products, oracle dispensers need an external quote,
 * and a dispenser with less than one full lot remaining cannot fill the advertised purchase.
 * The asset/status index bounds the read to the small open-XCP set.
 */
export interface XcpUnitDispenserAsk {
  tx_hash: string;
  give_remaining: string;
  sats: number;
}

export const XCP_UNIT_DISPENSER_ASKS_SQL = `SELECT lower(hex(dispenser.tx_hash)) tx_hash,
    dispenser.give_remaining,CAST(dispenser.satoshirate AS INTEGER) sats
  FROM dispensers dispenser INDEXED BY idx_dispensers_asset_status
  WHERE dispenser.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
    AND dispenser.status=0 AND dispenser.oracle_address_id IS NULL
    AND CAST(dispenser.give_quantity AS INTEGER)=100000000
    AND CAST(dispenser.give_remaining AS INTEGER)>=CAST(dispenser.give_quantity AS INTEGER)
    AND CAST(dispenser.satoshirate AS INTEGER)>0
  ORDER BY CAST(dispenser.satoshirate AS INTEGER),dispenser.tx_index`;

export function xcpUnitDispenserAsks(db: D1Database): Promise<XcpUnitDispenserAsk[]> {
  return q<XcpUnitDispenserAsk>(db, XCP_UNIT_DISPENSER_ASKS_SQL);
}

/**
 * The derivation the projection replaces, kept as the fallback for when the
 * projection is stale. This is deliberately the SAME aggregate the builder
 * stores, so the two cannot disagree about what supply means.
 */
const DERIVE_SUPPLY_SQL = `SELECT day, SUM(delta) OVER (ORDER BY day) / 1e8 supply FROM (
     SELECT date(block.block_time,'unixepoch') day,
       SUM(CASE WHEN ledger.direction=1 THEN CAST(ledger.quantity AS REAL)
         ELSE -CAST(ledger.quantity AS REAL) END) delta
     FROM ledger_events ledger JOIN blocks block ON block.block_index=ledger.block_index
     WHERE ledger.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
     GROUP BY day
   ) ORDER BY day`;

export async function xcpHistory(db: D1Database): Promise<PriceHistoryPoint[]> {
  // Supply: XCP only ever mints via burns and destroys via fees/destructions, and every such
  // change is a one-sided row in the 1:1 credit/debit capture — so the running credit−debit sum
  // IS the daily supply curve. Validated against balances (difference = open-order escrow).
  // The carry-forward onto price days happens HERE, not as a correlated SQL subquery: the temp
  // supply CTE carries no index, so per-price-day lookups scanned it quadratically (~21M billed
  // rows read per call). Two ordered result sets merge in one linear pass instead.
  //
  // Read from the projection, not re-derived. Deriving it is a window function
  // over the whole of ledger_events joined to blocks — 3,313,631 rows read per
  // call, measured — and this runs on every cache miss of /v2/price, which came
  // to 271,717,710 rows/day, 11% of the account's entire D1 reads, for ~4,600
  // rows that change once a day. xcp_supply_daily holds the result of that
  // exact aggregate; indexer/xcp-supply.ts recomputes and stores it daily.
  let supplyByDay = await q<{ day: string; supply: number }>(
    db,
    `SELECT day, supply FROM xcp_supply_daily ORDER BY day`,
  );
  /**
   * Fall back to deriving when the projection is stale.
   *
   * Reading a table instead of deriving traded freshness-BY-CONSTRUCTION for
   * freshness-by-cron: the old query could not be out of date, and this one
   * can. Silence is the failure mode that matters — if the refresh stops, every
   * caller keeps getting a plausible supply curve that quietly stops moving,
   * and nothing errors.
   *
   * So the read path checks. The newest row is free (the list is already
   * ordered), and if it has fallen behind, this pays the 3.3M-row derivation
   * rather than serve a number it knows is wrong. Correctness is not the thing
   * being optimised here; cost is, and only while cost is safe.
   *
   * Two days of slack: the builder is gated at ~144 blocks (~24h), so one
   * missed run is normal operation rather than a fault.
   */
  const newestSupplyDay = supplyByDay.at(-1)?.day;
  const staleCutoff = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  if (!newestSupplyDay || newestSupplyDay < staleCutoff) {
    console.error(
      `xcp_supply_daily stale (newest=${newestSupplyDay ?? "empty"}, cutoff=${staleCutoff}) — deriving instead; check refreshXcpSupply`,
    );
    supplyByDay = await q<{ day: string; supply: number }>(db, DERIVE_SUPPLY_SQL);
  }
  const history = await q<PriceHistoryPoint>(
    db,
    `SELECT xcp.day, ROUND(xcp.usd, 6) usd, xcp.source, ROUND(btc.usd, 2) btc,
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
  let cursor = 0;
  let running: number | null = null;
  for (const point of history) {
    while (cursor < supplyByDay.length && supplyByDay[cursor].day <= point.day) running = supplyByDay[cursor++].supply;
    point.supply = running === null ? null : Math.round(running);
  }
  return history;
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

/**
 * Daily XCP/BTC candles over the same fill universe as the indexer's market edge: completed
 * XCP↔BTC order matches plus arm's-length XCP dispenses, positive quantities only. Raw daily
 * extremes are unusable here — real multi-fill days carry mispriced-dispenser prints 1,000×+ off
 * market, and such a print can carry most of a day's volume (measured 2026-07-27) — so the close
 * is the day's volume-weighted median (the exact statistic the USD calendar consumes) and the
 * wicks are volume-weighted 5th/95th percentile prices over only the fills within one order of
 * magnitude of that median: a fill 10× off the day's own price is an error print, not range.
 * Dust-only days (under 0.1 XCP total) are omitted; reported volume/fills stay whole-day.
 * Exported for the node:sqlite tests; owned by this module.
 */
export const XCP_DAILY_CANDLES_SQL = `WITH observations AS (
    SELECT date(match.block_time,'unixepoch') day,
      CASE WHEN forward_asset.asset='XCP'
        THEN CAST(match.backward_quantity AS REAL)/CAST(match.forward_quantity AS REAL)
        ELSE CAST(match.forward_quantity AS REAL)/CAST(match.backward_quantity AS REAL) END price,
      CASE WHEN forward_asset.asset='XCP' THEN CAST(match.forward_quantity AS INTEGER)
        ELSE CAST(match.backward_quantity AS INTEGER) END volume_xcp
    FROM order_matches match
    JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
    JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
    WHERE match.status='completed' AND match.block_time IS NOT NULL
      AND CAST(match.forward_quantity AS INTEGER)>0 AND CAST(match.backward_quantity AS INTEGER)>0
      AND ((forward_asset.asset='XCP' AND backward_asset.asset='BTC')
        OR (forward_asset.asset='BTC' AND backward_asset.asset='XCP'))
    UNION ALL
    SELECT date(dispense.block_time,'unixepoch') day,
      COALESCE(
        CAST(parent.satoshirate AS REAL)/NULLIF(CAST(parent.give_quantity AS REAL),0),
        CAST(dispense.btc_amount AS REAL)/CAST(dispense.dispense_quantity AS REAL)
      ) price,
      CAST(dispense.dispense_quantity AS INTEGER) volume_xcp
    FROM dispenses dispense
    LEFT JOIN dispensers parent ON parent.tx_index=dispense.dispenser_tx_index
    WHERE dispense.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
      AND dispense.block_time IS NOT NULL AND dispense.source_id<>dispense.destination_id
      AND CAST(dispense.btc_amount AS INTEGER)>0 AND CAST(dispense.dispense_quantity AS INTEGER)>0
  ), ranked AS (
    SELECT day, price, volume_xcp,
      SUM(volume_xcp) OVER(PARTITION BY day ORDER BY price ROWS UNBOUNDED PRECEDING) cumulative_volume,
      SUM(volume_xcp) OVER(PARTITION BY day) total_volume,
      COUNT(*) OVER(PARTITION BY day) fills
    FROM observations
  ), day_median AS (
    SELECT day, MIN(CASE WHEN cumulative_volume*2>=total_volume THEN price END) vwm,
      MAX(total_volume) total_volume, MAX(fills) fills
    FROM ranked GROUP BY day
  ), banded AS (
    SELECT observation.day, observation.price, observation.volume_xcp,
      SUM(observation.volume_xcp) OVER(PARTITION BY observation.day ORDER BY observation.price
        ROWS UNBOUNDED PRECEDING) cumulative_volume,
      SUM(observation.volume_xcp) OVER(PARTITION BY observation.day) total_volume
    FROM observations observation
    JOIN day_median median ON median.day=observation.day
    WHERE observation.price BETWEEN median.vwm/10 AND median.vwm*10
  )
  SELECT median.day,
    MIN(CASE WHEN banded.cumulative_volume*20>=banded.total_volume THEN banded.price END) low,
    median.vwm close,
    MIN(CASE WHEN banded.cumulative_volume*20>=banded.total_volume*19 THEN banded.price END) high,
    ROUND(median.total_volume/1e8,3) volume, median.fills fills, MAX(btc.usd) btc
  FROM day_median median
  JOIN banded ON banded.day=median.day
  LEFT JOIN prices btc ON btc.currency='BTC' AND btc.day=median.day
  WHERE median.total_volume>=1e7
  GROUP BY median.day ORDER BY median.day`;

export function xcpDailyCandles(db: D1Database): Promise<PriceCandlePoint[]> {
  return q<PriceCandlePoint>(db, XCP_DAILY_CANDLES_SQL);
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
