/**
 * Daily USD price feed + trade USD backfill. Fills `trades.usd_value` so the unified sales stream is comparable
 * in dollars across venues (XCP/BTC/ETH), on top of the USDC rows already priced at ingest.
 *
 *   BTC/USD, ETH/USD  ← Coinbase Exchange daily candles (no key; resumable backfill to 2015/2016)
 *   XCP/USD           ← observed CMC aggregate when available; otherwise XCP/BTC × BTC/USD
 *
 * `prices(day, currency, usd)` is the calendar; `applyTradeUsd` maps each trade's day+currency onto it.
 */
import type { Env } from "#api/env";
import { fetchCoinbaseCandles, fetchCoinbaseSpot } from "#api/integrations/coinbase";
import { fetchDexTradeMarket, type DexTradeObservation } from "#api/integrations/dex-trade";
import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

// Coinbase product + first-listed day (unix sec) per currency.
const COINS: Record<string, { product: string; start: number }> = {
  BTC: { product: "BTC-USD", start: 1437350400 }, // 2015-07-20
  ETH: { product: "ETH-USD", start: 1463529600 }, // 2016-05-18
};
const DAY = 86400;
const WIN = 300 * DAY; // Coinbase caps candles at 300/request
const WINDOWS_PER_CALL = 8; // ~2400 days per currency per admin call → backfills in ~2 passes

const isoDay = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

type PriceWrite = {
  day: string;
  currency: string;
  usd: number;
  source: string;
  observedDay: string;
  fidelity: number;
};

/** Persist a directly observed BTC/USD ticker and a recent XCP/BTC exchange ticker, with explicit lower
 * fidelity than the completed daily calendar but higher fidelity than a carried on-chain edge. This prices
 * today's new sales immediately; it never rewrites a historical day with today's quote. */
export async function crawlSpotPrices(env: Env): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1_000);
  try {
    const [btcUsd, xcp] = await Promise.all([fetchCoinbaseSpot("BTC-USD"), fetchDexTradeMarket("XCPBTC")]);
    const spot = { BTC: btcUsd, XCP: xcp.price * btcUsd };
    const day = isoDay(now);
    await upsertDexTradeObservation(env.CORE_DB, xcp);
    let pepecash: DexTradeObservation | null = null;
    try {
      pepecash = await fetchDexTradeMarket("PEPECASHBTC");
      await upsertDexTradeObservation(env.CORE_DB, pepecash);
    } catch {
      // PEPECASH is thin; lack of a fresh execution must not block BTC/XCP maintenance.
    }
    await upsertPrices(
      env.CORE_DB,
      Object.entries(spot).map(([currency, usd]) => ({
        day,
        currency,
        usd,
        source: currency === "BTC" ? "coinbase_spot" : "dextrade_xcpbtc_spot",
        observedDay: day,
        fidelity: 2,
      })),
    );
    const applied = await env.CORE_DB.prepare(
      `UPDATE trades SET usd_value=total*(
         SELECT price.usd FROM prices price
         WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))
       WHERE currency IN ('BTC','XCP') AND date(block_time,'unixepoch')=?
         AND usd_value IS NOT total*(SELECT price.usd FROM prices price
           WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))`,
    ).bind(day).run();
    return {
      day,
      BTC: spot.BTC,
      XCP: spot.XCP,
      dextrade_observations: pepecash ? [xcp.pair, pepecash.pair] : [xcp.pair],
      priced_rows: applied.meta.rows_written ?? 0,
    };
  } catch (error) {
    return { err: error instanceof Error ? error.message : String(error) };
  }
}

async function upsertDexTradeObservation(db: D1Database, observation: DexTradeObservation): Promise<void> {
  const baseCurrency = observation.pair.slice(0, -3);
  await db.prepare(`INSERT INTO market_price_observations(
    day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
    price=excluded.price,volume_base=excluded.volume_base,trades=excluded.trades,
    first_time=excluded.first_time,last_time=excluded.last_time,method=excluded.method
  WHERE excluded.last_time>COALESCE(market_price_observations.last_time,0)`)
    .bind(
      isoDay(observation.latestTime), baseCurrency, "BTC", "dex-trade", "cex", observation.latestPrice,
      observation.latestVolume, 1, observation.latestTime, observation.latestTime, "latest_observed_execution",
    ).run();
}

const DERIVED_FRESH_DAYS = 7;

export const BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL = `INSERT INTO market_price_observations(
  day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method)
  WITH observations AS (
    SELECT date(match.block_time,'unixepoch') day,
      CASE WHEN forward_asset.asset='XCP'
        THEN CAST(match.backward_quantity AS REAL)/CAST(match.forward_quantity AS REAL)
        ELSE CAST(match.forward_quantity AS REAL)/CAST(match.backward_quantity AS REAL) END price,
      CASE WHEN forward_asset.asset='XCP' THEN CAST(match.forward_quantity AS INTEGER)
        ELSE CAST(match.backward_quantity AS INTEGER) END volume_xcp,
      match.block_time observation_time
    FROM order_matches match
    JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
    JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
    WHERE match.status='completed' AND CAST(match.forward_quantity AS INTEGER)>0
      AND CAST(match.backward_quantity AS INTEGER)>0
      AND ((forward_asset.asset='XCP' AND backward_asset.asset='BTC')
        OR (forward_asset.asset='BTC' AND backward_asset.asset='XCP'))
  ), ranked AS (
    SELECT day,price,volume_xcp,observation_time,
      SUM(volume_xcp) OVER(PARTITION BY day ORDER BY price ROWS UNBOUNDED PRECEDING) cumulative_volume,
      SUM(volume_xcp) OVER(PARTITION BY day) total_volume,
      COUNT(*) OVER(PARTITION BY day) trades,
      MIN(observation_time) OVER(PARTITION BY day) first_time,
      MAX(observation_time) OVER(PARTITION BY day) last_time
    FROM observations
  )
  SELECT day,'XCP','BTC','counterparty','dex',MIN(price),MAX(total_volume)/1e8,MAX(trades),
    MIN(first_time),MAX(last_time),'volume_weighted_median'
  FROM ranked WHERE cumulative_volume*2>=total_volume GROUP BY day
  ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET price=excluded.price,
    volume_base=excluded.volume_base,trades=excluded.trades,first_time=excluded.first_time,
    last_time=excluded.last_time,method=excluded.method
  WHERE market_price_observations.price IS NOT excluded.price
    OR market_price_observations.volume_base IS NOT excluded.volume_base
    OR market_price_observations.trades IS NOT excluded.trades
    OR market_price_observations.first_time IS NOT excluded.first_time
    OR market_price_observations.last_time IS NOT excluded.last_time
    OR market_price_observations.method IS NOT excluded.method`;

export const PRUNE_COUNTERPARTY_PRICE_OBSERVATIONS_SQL = `DELETE FROM market_price_observations
  WHERE source='counterparty' AND venue='dex' AND base_currency='XCP' AND quote_currency='BTC'
    AND day NOT IN (
    SELECT DISTINCT date(match.block_time,'unixepoch')
    FROM order_matches match
    JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
    JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
    WHERE match.status='completed' AND match.block_time IS NOT NULL
      AND CAST(match.forward_quantity AS INTEGER)>0 AND CAST(match.backward_quantity AS INTEGER)>0
      AND ((forward_asset.asset='XCP' AND backward_asset.asset='BTC')
        OR (forward_asset.asset='BTC' AND backward_asset.asset='XCP'))
  )`;

/** Genesis burns are protocol conversions, not trades. They form the authoritative pre-DEX XCP/BTC edge. */
export const BUILD_BURN_PRICE_OBSERVATIONS_SQL = `INSERT INTO market_price_observations(
  day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method)
  WITH observations AS (
    SELECT date(block_time,'unixepoch') day,
      CAST(burned AS REAL)/CAST(earned AS REAL) price,
      CAST(earned AS INTEGER) volume_xcp,block_time observation_time
    FROM burns WHERE status='valid' AND block_time IS NOT NULL
      AND CAST(burned AS INTEGER)>0 AND CAST(earned AS INTEGER)>0
  ), ranked AS (
    SELECT day,price,volume_xcp,observation_time,
      SUM(volume_xcp) OVER(PARTITION BY day ORDER BY price ROWS UNBOUNDED PRECEDING) cumulative_volume,
      SUM(volume_xcp) OVER(PARTITION BY day) total_volume,
      COUNT(*) OVER(PARTITION BY day) conversions,
      MIN(observation_time) OVER(PARTITION BY day) first_time,
      MAX(observation_time) OVER(PARTITION BY day) last_time
    FROM observations
  )
  SELECT day,'XCP','BTC','counterparty','burn',MIN(price),MAX(total_volume)/1e8,MAX(conversions),
    MIN(first_time),MAX(last_time),'protocol_conversion_vwm'
  FROM ranked WHERE cumulative_volume*2>=total_volume GROUP BY day
  ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET price=excluded.price,
    volume_base=excluded.volume_base,trades=excluded.trades,first_time=excluded.first_time,
    last_time=excluded.last_time,method=excluded.method
  WHERE market_price_observations.price IS NOT excluded.price
    OR market_price_observations.volume_base IS NOT excluded.volume_base
    OR market_price_observations.trades IS NOT excluded.trades
    OR market_price_observations.first_time IS NOT excluded.first_time
    OR market_price_observations.last_time IS NOT excluded.last_time
    OR market_price_observations.method IS NOT excluded.method`;

export const PRUNE_BURN_PRICE_OBSERVATIONS_SQL = `DELETE FROM market_price_observations
  WHERE source='counterparty' AND venue='burn' AND base_currency='XCP' AND quote_currency='BTC'
    AND day NOT IN (SELECT DISTINCT date(block_time,'unixepoch') FROM burns
      WHERE status='valid' AND block_time IS NOT NULL
        AND CAST(burned AS INTEGER)>0 AND CAST(earned AS INTEGER)>0)`;

/** Direct aggregate USD observations outrank a cross-rate, while retaining explicit source provenance. */
export const BUILD_OBSERVED_XCP_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
  SELECT day,'XCP',price,'coinmarketcap_aggregate',day,2 FROM market_price_observations
  WHERE base_currency='XCP' AND quote_currency='USD'
    AND source='coinmarketcap' AND venue='aggregate' AND price>0
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity
  WHERE prices.fidelity<=excluded.fidelity AND (
    prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
    OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity)`;

export const PRUNE_OBSERVED_XCP_USD_SQL = `DELETE FROM prices
  WHERE currency='XCP' AND source='coinmarketcap_aggregate' AND NOT EXISTS (
    SELECT 1 FROM market_price_observations observation
    WHERE observation.day=prices.day AND observation.base_currency='XCP' AND observation.quote_currency='USD'
      AND observation.source='coinmarketcap' AND observation.venue='aggregate' AND observation.price>0)`;

export const BUILD_XCP_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
  SELECT btc.day,'XCP',edge.price*btc.usd,'dex_vwm',edge.day,1
  FROM prices btc
  JOIN market_price_observations edge ON edge.day=(
    SELECT recent.day FROM market_price_observations recent
    WHERE recent.day BETWEEN date(btc.day,'-${DERIVED_FRESH_DAYS} days') AND btc.day
      AND recent.base_currency='XCP' AND recent.quote_currency='BTC'
      AND recent.source='counterparty' AND recent.venue='dex'
    ORDER BY recent.day DESC LIMIT 1)
  WHERE btc.currency='BTC' AND edge.base_currency='XCP' AND edge.quote_currency='BTC'
    AND edge.source='counterparty' AND edge.venue='dex'
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity
  WHERE prices.fidelity<=excluded.fidelity AND (
    prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
    OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity
  )`;

export const PRUNE_XCP_USD_SQL = `DELETE FROM prices
  WHERE currency='XCP' AND source='dex_vwm' AND NOT EXISTS (
    SELECT 1 FROM prices btc
    JOIN market_price_observations edge ON edge.day=(
      SELECT recent.day FROM market_price_observations recent
      WHERE recent.day BETWEEN date(btc.day,'-${DERIVED_FRESH_DAYS} days') AND btc.day
        AND recent.base_currency='XCP' AND recent.quote_currency='BTC'
        AND recent.source='counterparty' AND recent.venue='dex'
      ORDER BY recent.day DESC LIMIT 1)
    WHERE btc.currency='BTC' AND btc.day=prices.day
      AND edge.base_currency='XCP' AND edge.quote_currency='BTC'
      AND edge.source='counterparty' AND edge.venue='dex'
  )`;

async function upsertPrices(db: D1Database, rows: PriceWrite[]) {
  for (let i = 0; i < rows.length; i += 100) {
    await db.batch(
      rows.slice(i, i + 100).map((row) =>
        db
          .prepare(
            `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity) VALUES(?,?,?,?,?,?)
             ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
               observed_day=excluded.observed_day,fidelity=excluded.fidelity
             WHERE prices.fidelity<=excluded.fidelity AND (
               prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
               OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity
             )`,
          )
          .bind(row.day, row.currency, row.usd, row.source, row.observedDay, row.fidelity),
      ),
    );
  }
}

// One Coinbase window: [[time, low, high, open, close, volume], ...] (close = index 4).
async function cbWindow(product: string, start: number, end: number) {
  return fetchCoinbaseCandles(product, start, end, DAY);
}

/** Backfill BTC/ETH from Coinbase (resumable per-currency cursor), then re-derive XCP from our DEX × BTC. */
export async function crawlPrices(env: Env): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, unknown> = {};

  for (const [cur, cfg] of Object.entries(COINS)) {
    let cursor = (await getCoreStateInt(env.CORE_DB, `prices_cur_${cur}`)) || cfg.start;
    let filled = 0;
    for (let w = 0; w < WINDOWS_PER_CALL && cursor < now; w++) {
      const end = Math.min(cursor + WIN, now);
      let rows: Awaited<ReturnType<typeof cbWindow>>;
      try {
        rows = await cbWindow(cfg.product, cursor, end);
      } catch (e) {
        out[`${cur}_err`] = String(e).slice(0, 60);
        break;
      }
      if (rows.length) {
        const prices = rows.map((r) => ({
          day: isoDay(r.time),
          currency: cur,
          usd: r.close,
          source: "coinbase",
          observedDay: isoDay(r.time),
          fidelity: 3,
        }));
        await upsertPrices(env.CORE_DB, prices);
        filled += rows.length;
      }
      cursor = end;
    }
    // don't pin the cursor at `now` while backfilling incompletely; leave a 2-day lip so the tail refreshes
    await setCoreState(env.CORE_DB, `prices_cur_${cur}`, Math.min(cursor, now - 2 * DAY));
    out[cur] = filled;
  }

  // Fold order matches once into a tiny indexed daily series. The former non-materialized CTE was searched
  // twice per BTC calendar day and D1 reported 8.3m rows read; this scans matches once, then seeks days.
  const xcpBtcUpsert = await env.CORE_DB.prepare(BUILD_COUNTERPARTY_PRICE_OBSERVATIONS_SQL).run();
  const xcpBtcPrune = await env.CORE_DB.prepare(PRUNE_COUNTERPARTY_PRICE_OBSERVATIONS_SQL).run();
  const burnUpsert = await env.CORE_DB.prepare(BUILD_BURN_PRICE_OBSERVATIONS_SQL).run();
  const burnPrune = await env.CORE_DB.prepare(PRUNE_BURN_PRICE_OBSERVATIONS_SQL).run();

  const observedXcpUsdUpsert = await env.CORE_DB.prepare(BUILD_OBSERVED_XCP_USD_SQL).run();
  const observedXcpUsdPrune = await env.CORE_DB.prepare(PRUNE_OBSERVED_XCP_USD_SQL).run();
  const xcpUsdUpsert = await env.CORE_DB.prepare(BUILD_XCP_USD_SQL).run();
  const xcpUsdPrune = await env.CORE_DB.prepare(PRUNE_XCP_USD_SQL).run();
  out.derived = {
    xcp_btc_upserted: xcpBtcUpsert.meta.rows_written ?? 0,
    xcp_btc_pruned: xcpBtcPrune.meta.rows_written ?? 0,
    burn_xcp_btc_upserted: burnUpsert.meta.rows_written ?? 0,
    burn_xcp_btc_pruned: burnPrune.meta.rows_written ?? 0,
    observed_xcp_usd_upserted: observedXcpUsdUpsert.meta.rows_written ?? 0,
    observed_xcp_usd_pruned: observedXcpUsdPrune.meta.rows_written ?? 0,
    xcp_usd_upserted: xcpUsdUpsert.meta.rows_written ?? 0,
    xcp_usd_pruned: xcpUsdPrune.meta.rows_written ?? 0,
  };

  const c = await env.CORE_DB.prepare(
    `SELECT currency, COUNT(*) n, MIN(day) lo, MAX(day) hi FROM prices GROUP BY currency`,
  ).all();
  // Calendar changes can correct any historical day, so schedule exactly one bounded full reconciliation.
  // Between daily refreshes the monotonic cursor prices only newly appended trades and then stays caught up.
  await setCoreState(env.CORE_DB, "usd_cur", 0);
  out.calendar = c.results ?? [];
  return out;
}

const USD_WINDOW = 200_000; // rows per apply call (rowid-windowed — contiguous across venues)

export function tradeUsdWindow(cursor: number, tip: number): { from: number; to: number } | null {
  return cursor >= tip ? null : { from: cursor, to: Math.min(cursor + USD_WINDOW, tip) };
}

export const APPLY_TRADE_USD_SQL = `UPDATE trades SET usd_value=total*(
    SELECT price.usd FROM prices price
    WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))
  WHERE currency IN ('BTC','ETH','XCP') AND rowid>? AND rowid<=?
    AND usd_value IS NOT total*(SELECT price.usd FROM prices price
      WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))`;

/** Reconcile the daily-reset history or newly appended rows, then remain idle when caught up. */
export async function applyTradeUsd(env: Env): Promise<Record<string, unknown>> {
  const tip = Number((await env.CORE_DB.prepare(`SELECT MAX(rowid) m FROM trades`).first<{ m: number }>())?.m) || 0;
  const cur = await getCoreStateInt(env.CORE_DB, "usd_cur");
  const window = tradeUsdWindow(cur, tip);
  if (!window) return { from: cur, to: cur, tip, priced_rows: 0, done: true };
  const hi = window.to;
  const result = await env.CORE_DB.prepare(APPLY_TRADE_USD_SQL)
    .bind(cur, hi)
    .run();
  await setCoreState(env.CORE_DB, "usd_cur", hi);
  return { from: cur, to: hi, tip, priced_rows: result.meta.rows_written ?? 0, done: hi >= tip };
}
