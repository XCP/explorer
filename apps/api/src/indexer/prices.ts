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
import { fetchDexTradeHistory, fetchDexTradeMarket, type DexTradeObservation } from "#api/integrations/dex-trade";
import { fetchCmcXcpLatest } from "#api/integrations/coinmarketcap";
import { fetchZaifTrades, zaifDailyVwm } from "#api/integrations/zaif";
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
  priceKind: "direct" | "derived";
  derivationDepth: number;
  selectionReason: string;
};

/**
 * usd-payment-v1 preserves the established fidelity tiers and makes ties deterministic. A daily Coinbase close
 * outranks its intraday spot fallback; a broad observed aggregate outranks a single latest-execution ticker; direct
 * observations outrank derived cross-rates. Diagnostic disagreement never selects a winner in this policy.
 */
export const PRICE_SELECTION_POLICY = "usd-payment-v1";

const sourceRank = (source: string) => `CASE ${source}
  WHEN 'coinbase' THEN 50
  WHEN 'coinbase_spot' THEN 40
  WHEN 'coinmarketcap_aggregate' THEN 30
  WHEN 'zaif_vwm' THEN 25
  WHEN 'dextrade_xcpbtc_spot' THEN 20
  WHEN 'burn_vwm' THEN 10
  WHEN 'market_vwm' THEN 6
  WHEN 'dex_vwm' THEN 5
  WHEN 'market_vwm_thin' THEN 4
  ELSE 0 END`;

const selectionPredicate = (current = "prices", candidate = "excluded") => `(
  ${candidate}.fidelity>${current}.fidelity OR (
    ${candidate}.fidelity=${current}.fidelity AND (
      ${sourceRank(`${candidate}.source`)}>${sourceRank(`${current}.source`)} OR
      (${candidate}.source=${current}.source)
    )
  )
)`;

export const PRICE_SELECTION_PREDICATE = selectionPredicate();

/** Import Dex-Trade's daily XCP/BTC candle history (their chart endpoint reaches back to 2024-06-30)
 *  as venue=cex observations with executed volume — the corroboration series the single-day spot
 *  captures never accumulated. Candle prices are satoshis (÷1e8 → BTC/XCP); volume is base-asset
 *  satoshi units (÷1e8 → XCP). Observations only: the daily calendar's selection policy is untouched. */
export async function importDexTradeHistory(env: Env): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1_000);
  const out: Record<string, unknown> = {};
  for (const pair of ["XCPBTC", "PEPECASHBTC"] as const) {
    const base = pair.slice(0, -3); // XCP | PEPECASH — the candle pair minus its BTC quote
    try {
      const candles = await fetchDexTradeHistory(pair, now);
      let written = 0;
      for (let i = 0; i < candles.length; i += 50) {
        const batch = candles.slice(i, i + 50).map((candle) =>
          env.CORE_DB.prepare(
            `INSERT INTO market_price_observations(
               day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method)
             VALUES(date(?1,'unixepoch'),?4,'BTC','dex-trade','cex',?2,?3,0,?1,?1,'daily_close')
             ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
               price=excluded.price,volume_base=excluded.volume_base,method=excluded.method,
               first_time=excluded.first_time,last_time=excluded.last_time`,
          ).bind(candle.time, candle.close / 1e8, candle.volume / 1e8, base),
        );
        const results = await env.CORE_DB.batch(batch);
        written += results.length;
      }
      out[base] = { candles: candles.length, written, from: candles[0]?.time, to: candles[candles.length - 1]?.time };
    } catch (error) {
      out[base] = { err: error instanceof Error ? error.message : String(error) };
    }
  }
  return out;
}

/** Keep the two strongest XCP sources flowing forward: CMC's aggregate (one free-tier credit per
 *  poll — the calendar's dominant source stopped accruing when the one-shot imports ended) and
 *  Zaif's live XCP/JPY tape (best-measured source in the audit; the monthly CSV import stays
 *  authoritative and overwrites live rows via its distinct method label). CMC lands in BOTH the
 *  observation store and the daily calendar at its established rank; Zaif stays observation-only
 *  until a selection-policy change is decided on its own merits. */
export async function crawlMarketQuotes(env: Env): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (env.CMC_API_KEY) {
    try {
      const quote = await fetchCmcXcpLatest(env.CMC_API_KEY);
      const day = quote.lastUpdated.slice(0, 10);
      await env.CORE_DB.prepare(
        `INSERT INTO market_price_observations(
           day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method)
         VALUES(?1,'XCP','USD','coinmarketcap','aggregate',?2,0,0,?3,?3,'latest_quote')
         ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
           price=excluded.price,first_time=COALESCE(market_price_observations.first_time,excluded.first_time),
           last_time=excluded.last_time,method=excluded.method`,
      )
        .bind(day, quote.priceUsd, Math.floor(Date.parse(quote.lastUpdated) / 1000))
        .run();
      await upsertPrices(env.CORE_DB, [
        {
          day,
          currency: "XCP",
          usd: quote.priceUsd,
          source: "coinmarketcap_aggregate",
          observedDay: day,
          fidelity: 2,
          priceKind: "direct",
          derivationDepth: 0,
          selectionReason: "direct_aggregate_usd",
        },
      ]);
      out.cmc = { day, usd: quote.priceUsd };
    } catch (error) {
      out.cmc = { err: error instanceof Error ? error.message : String(error) };
    }
  } else {
    out.cmc = { skipped: "CMC_API_KEY not configured" };
  }
  try {
    const days = zaifDailyVwm(await fetchZaifTrades("xcp_jpy"));
    let written = 0;
    for (const dayRow of days) {
      const result = await env.CORE_DB.prepare(
        `INSERT INTO market_price_observations(
           day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method)
         VALUES(?1,'XCP','JPY','zaif','cex',?2,?3,?4,?5,?6,'live_poll_vwm')
         ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
           price=excluded.price,volume_base=excluded.volume_base,trades=excluded.trades,
           first_time=excluded.first_time,last_time=excluded.last_time
         WHERE market_price_observations.method='live_poll_vwm'`,
      )
        .bind(dayRow.day, dayRow.price, dayRow.volume, dayRow.trades, dayRow.firstTime, dayRow.lastTime)
        .run();
      written += result.meta.rows_written ?? 0;
    }
    out.zaif = { days: days.length, written };
  } catch (error) {
    out.zaif = { err: error instanceof Error ? error.message : String(error) };
  }
  return out;
}

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
        priceKind: currency === "BTC" ? "direct" : "derived",
        derivationDepth: currency === "BTC" ? 0 : 1,
        selectionReason: "same_day_spot_fallback",
      })),
    );
    const applied = await env.CORE_DB.prepare(
      `UPDATE trades SET usd_value=total*(
         SELECT price.usd FROM prices price
         WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))
       WHERE currency IN ('BTC','XCP') AND date(block_time,'unixepoch')=?
         AND usd_value IS NOT total*(SELECT price.usd FROM prices price
           WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))`,
    )
      .bind(day)
      .run();
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
  await db
    .prepare(
      `INSERT INTO market_price_observations(
    day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
    price=excluded.price,volume_base=excluded.volume_base,trades=excluded.trades,
    first_time=excluded.first_time,last_time=excluded.last_time,method=excluded.method
  WHERE excluded.last_time>COALESCE(market_price_observations.last_time,0)`,
    )
    .bind(
      isoDay(observation.latestTime),
      baseCurrency,
      "BTC",
      "dex-trade",
      "cex",
      observation.latestPrice,
      observation.latestVolume,
      1,
      observation.latestTime,
      observation.latestTime,
      "latest_observed_execution",
    )
    .run();
}

const DERIVED_FRESH_DAYS = 7;

/**
 * Liquidity floor for the market edge to price a day at full rank. Measured against the CMC
 * aggregate over every overlap day (2026-07-20 sweep): unfloored the combined edge shows 0.245
 * mean |ln err| with a 19.9 worst case (dust-trigger and promo-dispenser days); at >=10 fills and
 * >=100 XCP it reaches 0.114 / 88% within 25% — better than the DEX-only edge ever measured
 * (0.195 / 74%). Days below the floor still price via the THIN tier, which ranks beneath every
 * other source and therefore only ever fills days nothing better covers (e.g. Feb 3-6, 2014).
 */
const MARKET_EDGE_MIN_TRADES = 10;
const MARKET_EDGE_MIN_VOLUME_XCP = 100;

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

/** XCP-for-BTC dispenses are executions at posted prices — the venue that carried XCP/BTC liquidity
 *  through the DEX's quiet years (2021: 4,446 fills/159.8 BTC vs a fading order book). Executions
 *  only — open dispensers are asks, not prices — and literal self-fills are excluded, consistent
 *  with the volume rule everywhere else. */
export const BUILD_DISPENSE_PRICE_OBSERVATIONS_SQL = `INSERT INTO market_price_observations(
  day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method)
  WITH observations AS (
    SELECT date(dispense.block_time,'unixepoch') day,
      CAST(dispense.btc_amount AS REAL)/CAST(dispense.dispense_quantity AS REAL) price,
      CAST(dispense.dispense_quantity AS INTEGER) volume_xcp,
      dispense.block_time observation_time
    FROM dispenses dispense
    WHERE dispense.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
      AND dispense.block_time IS NOT NULL AND dispense.source_id<>dispense.destination_id
      AND CAST(dispense.btc_amount AS INTEGER)>0 AND CAST(dispense.dispense_quantity AS INTEGER)>0
  ), ranked AS (
    SELECT day,price,volume_xcp,observation_time,
      SUM(volume_xcp) OVER(PARTITION BY day ORDER BY price ROWS UNBOUNDED PRECEDING) cumulative_volume,
      SUM(volume_xcp) OVER(PARTITION BY day) total_volume,
      COUNT(*) OVER(PARTITION BY day) trades,
      MIN(observation_time) OVER(PARTITION BY day) first_time,
      MAX(observation_time) OVER(PARTITION BY day) last_time
    FROM observations
  )
  SELECT day,'XCP','BTC','counterparty','dispense',MIN(price),MAX(total_volume)/1e8,MAX(trades),
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

export const PRUNE_DISPENSE_PRICE_OBSERVATIONS_SQL = `DELETE FROM market_price_observations
  WHERE source='counterparty' AND venue='dispense' AND base_currency='XCP' AND quote_currency='BTC'
    AND day NOT IN (
    SELECT DISTINCT date(dispense.block_time,'unixepoch') FROM dispenses dispense
    WHERE dispense.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
      AND dispense.block_time IS NOT NULL AND dispense.source_id<>dispense.destination_id
      AND CAST(dispense.btc_amount AS INTEGER)>0 AND CAST(dispense.dispense_quantity AS INTEGER)>0
  )`;

/** The combined on-chain XCP/BTC edge: one TRUE volume-weighted median over the union of DEX order
 *  matches and dispense executions — not a blend of per-venue medians. This is the edge the USD
 *  cross-rate consumes; the per-venue rows above it exist for provenance and display. */
export const BUILD_MARKET_PRICE_OBSERVATIONS_SQL = `INSERT INTO market_price_observations(
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
    UNION ALL
    SELECT date(dispense.block_time,'unixepoch') day,
      CAST(dispense.btc_amount AS REAL)/CAST(dispense.dispense_quantity AS REAL) price,
      CAST(dispense.dispense_quantity AS INTEGER) volume_xcp,
      dispense.block_time observation_time
    FROM dispenses dispense
    WHERE dispense.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
      AND dispense.block_time IS NOT NULL AND dispense.source_id<>dispense.destination_id
      AND CAST(dispense.btc_amount AS INTEGER)>0 AND CAST(dispense.dispense_quantity AS INTEGER)>0
  ), ranked AS (
    SELECT day,price,volume_xcp,observation_time,
      SUM(volume_xcp) OVER(PARTITION BY day ORDER BY price ROWS UNBOUNDED PRECEDING) cumulative_volume,
      SUM(volume_xcp) OVER(PARTITION BY day) total_volume,
      COUNT(*) OVER(PARTITION BY day) trades,
      MIN(observation_time) OVER(PARTITION BY day) first_time,
      MAX(observation_time) OVER(PARTITION BY day) last_time
    FROM observations
  )
  SELECT day,'XCP','BTC','counterparty','market',MIN(price),MAX(total_volume)/1e8,MAX(trades),
    MIN(first_time),MAX(last_time),'cross_venue_volume_weighted_median'
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

export const PRUNE_MARKET_PRICE_OBSERVATIONS_SQL = `DELETE FROM market_price_observations
  WHERE source='counterparty' AND venue='market' AND base_currency='XCP' AND quote_currency='BTC'
    AND day NOT IN (
      SELECT date(match.block_time,'unixepoch')
      FROM order_matches match
      JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
      JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
      WHERE match.status='completed' AND match.block_time IS NOT NULL
        AND CAST(match.forward_quantity AS INTEGER)>0 AND CAST(match.backward_quantity AS INTEGER)>0
        AND ((forward_asset.asset='XCP' AND backward_asset.asset='BTC')
          OR (forward_asset.asset='BTC' AND backward_asset.asset='XCP'))
      UNION
      SELECT date(dispense.block_time,'unixepoch') FROM dispenses dispense
      WHERE dispense.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
        AND dispense.block_time IS NOT NULL AND dispense.source_id<>dispense.destination_id
        AND CAST(dispense.btc_amount AS INTEGER)>0 AND CAST(dispense.dispense_quantity AS INTEGER)>0
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
export const BUILD_OBSERVED_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity,
    policy_version,price_kind,age_days,derivation_depth,observation_count,venue_count,volume_base,
    disagreement_class,selection_reason)
  SELECT day,base_currency,price,'coinmarketcap_aggregate',day,2,'${PRICE_SELECTION_POLICY}','direct',0,0,
    NULLIF(trades,0),1,NULLIF(volume_base,0),'not_evaluated','direct_aggregate_usd' FROM market_price_observations
  WHERE base_currency IN ('BTC','XCP') AND quote_currency='USD'
    AND source='coinmarketcap' AND venue='aggregate' AND price>0
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity,policy_version=excluded.policy_version,
    price_kind=excluded.price_kind,age_days=excluded.age_days,derivation_depth=excluded.derivation_depth,
    observation_count=excluded.observation_count,venue_count=excluded.venue_count,volume_base=excluded.volume_base,
    disagreement_class=excluded.disagreement_class,selection_reason=excluded.selection_reason
  WHERE ${PRICE_SELECTION_PREDICATE} AND (
    prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
    OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity)`;

export const PRUNE_OBSERVED_USD_SQL = `DELETE FROM prices
  WHERE currency IN ('BTC','XCP') AND source='coinmarketcap_aggregate' AND NOT EXISTS (
    SELECT 1 FROM market_price_observations observation
    WHERE observation.day=prices.day AND observation.base_currency=prices.currency
      AND observation.quote_currency='USD'
      AND observation.source='coinmarketcap' AND observation.venue='aggregate' AND observation.price>0)`;

/** Zaif XCP/JPY daily VWM through the official ECB cross (EUR/USD ÷ EUR/JPY, ≤4-day weekend carry) —
 *  the best-measured XCP source in the audit (0.032 median |ln err| vs CMC; ranked-Zaif-first beat
 *  every alternative 2× in the 749-day CMC holdout, see the 2026-07-21 proposal). UNfloored by
 *  measurement: an order book prices even single fills sanely. Ranked between the CMC aggregate
 *  (which keeps every day it covers) and the Dex-Trade spot it supersedes as first fallback. */
export const BUILD_ZAIF_XCP_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity,
    policy_version,price_kind,age_days,derivation_depth,observation_count,venue_count,volume_base,
    disagreement_class,selection_reason)
  SELECT z.day,'XCP',z.price*usd_leg.price/jpy_leg.price,'zaif_vwm',z.day,2,'${PRICE_SELECTION_POLICY}','derived',
    0,1,NULLIF(z.trades,0),1,NULLIF(z.volume_base,0),'not_evaluated','first_party_cex_fx_cross'
  FROM market_price_observations z
  JOIN market_price_observations usd_leg ON usd_leg.source='ecb' AND usd_leg.venue='reference'
    AND usd_leg.base_currency='EUR' AND usd_leg.quote_currency='USD' AND usd_leg.day=(
      SELECT u.day FROM market_price_observations u
      WHERE u.source='ecb' AND u.venue='reference' AND u.base_currency='EUR' AND u.quote_currency='USD'
        AND u.day<=z.day AND u.day>=date(z.day,'-4 days') ORDER BY u.day DESC LIMIT 1)
  JOIN market_price_observations jpy_leg ON jpy_leg.source='ecb' AND jpy_leg.venue='reference'
    AND jpy_leg.base_currency='EUR' AND jpy_leg.quote_currency='JPY' AND jpy_leg.day=(
      SELECT j.day FROM market_price_observations j
      WHERE j.source='ecb' AND j.venue='reference' AND j.base_currency='EUR' AND j.quote_currency='JPY'
        AND j.day<=z.day AND j.day>=date(z.day,'-4 days') ORDER BY j.day DESC LIMIT 1)
  WHERE z.source='zaif' AND z.venue='cex' AND z.base_currency='XCP' AND z.quote_currency='JPY'
    AND z.price>0 AND usd_leg.price>0 AND jpy_leg.price>0
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity,policy_version=excluded.policy_version,
    price_kind=excluded.price_kind,age_days=excluded.age_days,derivation_depth=excluded.derivation_depth,
    observation_count=excluded.observation_count,venue_count=excluded.venue_count,volume_base=excluded.volume_base,
    disagreement_class=excluded.disagreement_class,selection_reason=excluded.selection_reason
  WHERE ${PRICE_SELECTION_PREDICATE} AND (
    prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
    OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity
  )`;

export const PRUNE_ZAIF_XCP_USD_SQL = `DELETE FROM prices
  WHERE currency='XCP' AND source='zaif_vwm' AND NOT EXISTS (
    SELECT 1 FROM market_price_observations z
    WHERE z.source='zaif' AND z.venue='cex' AND z.base_currency='XCP' AND z.quote_currency='JPY'
      AND z.day=prices.day AND z.price>0
      AND EXISTS (SELECT 1 FROM market_price_observations u
        WHERE u.source='ecb' AND u.venue='reference' AND u.base_currency='EUR' AND u.quote_currency='USD'
          AND u.day<=z.day AND u.day>=date(z.day,'-4 days'))
      AND EXISTS (SELECT 1 FROM market_price_observations j
        WHERE j.source='ecb' AND j.venue='reference' AND j.base_currency='EUR' AND j.quote_currency='JPY'
          AND j.day<=z.day AND j.day>=date(z.day,'-4 days'))
  )`;

/** During the genesis burn, on-chain BTC/XCP conversion × same-day BTC/USD is reproducible XCP/USD evidence. */
export const BUILD_BURN_XCP_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity,
    policy_version,price_kind,age_days,derivation_depth,observation_count,venue_count,volume_base,
    disagreement_class,selection_reason)
  SELECT btc.day,'XCP',edge.price*btc.usd,'burn_vwm',edge.day,1,'${PRICE_SELECTION_POLICY}','derived',0,1,
    edge.trades,1,edge.volume_base,'not_evaluated','same_day_burn_cross_rate'
  FROM prices btc JOIN market_price_observations edge ON edge.day=btc.day
  WHERE btc.currency='BTC' AND edge.base_currency='XCP' AND edge.quote_currency='BTC'
    AND edge.source='counterparty' AND edge.venue='burn'
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity,policy_version=excluded.policy_version,
    price_kind=excluded.price_kind,age_days=excluded.age_days,derivation_depth=excluded.derivation_depth,
    observation_count=excluded.observation_count,venue_count=excluded.venue_count,volume_base=excluded.volume_base,
    disagreement_class=excluded.disagreement_class,selection_reason=excluded.selection_reason
  WHERE ${PRICE_SELECTION_PREDICATE} AND (
    prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
    OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity)`;

export const PRUNE_BURN_XCP_USD_SQL = `DELETE FROM prices
  WHERE currency='XCP' AND source='burn_vwm' AND NOT EXISTS (
    SELECT 1 FROM prices btc JOIN market_price_observations edge ON edge.day=btc.day
    WHERE btc.currency='BTC' AND btc.day=prices.day AND edge.base_currency='XCP' AND edge.quote_currency='BTC'
      AND edge.source='counterparty' AND edge.venue='burn')`;

export const BUILD_XCP_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity,
    policy_version,price_kind,age_days,derivation_depth,observation_count,venue_count,volume_base,
    disagreement_class,selection_reason)
  SELECT btc.day,'XCP',edge.price*btc.usd,'market_vwm',edge.day,1,'${PRICE_SELECTION_POLICY}','derived',
    CAST(julianday(btc.day)-julianday(edge.day) AS INTEGER),1,edge.trades,1,edge.volume_base,
    'not_evaluated','fresh_market_cross_rate'
  FROM prices btc
  JOIN market_price_observations edge ON edge.day=(
    SELECT recent.day FROM market_price_observations recent
    WHERE recent.day BETWEEN date(btc.day,'-${DERIVED_FRESH_DAYS} days') AND btc.day
      AND recent.base_currency='XCP' AND recent.quote_currency='BTC'
      AND recent.source='counterparty' AND recent.venue='market'
      AND recent.trades>=${MARKET_EDGE_MIN_TRADES} AND recent.volume_base>=${MARKET_EDGE_MIN_VOLUME_XCP}
    ORDER BY recent.day DESC LIMIT 1)
  WHERE btc.currency='BTC' AND edge.base_currency='XCP' AND edge.quote_currency='BTC'
    AND edge.source='counterparty' AND edge.venue='market'
    AND edge.trades>=${MARKET_EDGE_MIN_TRADES} AND edge.volume_base>=${MARKET_EDGE_MIN_VOLUME_XCP}
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity,policy_version=excluded.policy_version,
    price_kind=excluded.price_kind,age_days=excluded.age_days,derivation_depth=excluded.derivation_depth,
    observation_count=excluded.observation_count,venue_count=excluded.venue_count,volume_base=excluded.volume_base,
    disagreement_class=excluded.disagreement_class,selection_reason=excluded.selection_reason
  WHERE ${PRICE_SELECTION_PREDICATE} AND (
    prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
    OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity
  )`;

/** The thin tier: same cross-rate over the freshest edge REGARDLESS of the liquidity floor, at a
 *  rank beneath every other source — it can never displace anything, so it only ever fills days
 *  that would otherwise have no price at all. Labeled distinctly so a reader always sees that the
 *  day was priced on thin evidence. */
export const BUILD_THIN_XCP_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity,
    policy_version,price_kind,age_days,derivation_depth,observation_count,venue_count,volume_base,
    disagreement_class,selection_reason)
  SELECT btc.day,'XCP',edge.price*btc.usd,'market_vwm_thin',edge.day,1,'${PRICE_SELECTION_POLICY}','derived',
    CAST(julianday(btc.day)-julianday(edge.day) AS INTEGER),1,edge.trades,1,edge.volume_base,
    'not_evaluated','thin_market_cross_rate'
  FROM prices btc
  JOIN market_price_observations edge ON edge.day=(
    SELECT recent.day FROM market_price_observations recent
    WHERE recent.day BETWEEN date(btc.day,'-${DERIVED_FRESH_DAYS} days') AND btc.day
      AND recent.base_currency='XCP' AND recent.quote_currency='BTC'
      AND recent.source='counterparty' AND recent.venue='market'
    ORDER BY recent.day DESC LIMIT 1)
  WHERE btc.currency='BTC' AND edge.base_currency='XCP' AND edge.quote_currency='BTC'
    AND edge.source='counterparty' AND edge.venue='market'
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity,policy_version=excluded.policy_version,
    price_kind=excluded.price_kind,age_days=excluded.age_days,derivation_depth=excluded.derivation_depth,
    observation_count=excluded.observation_count,venue_count=excluded.venue_count,volume_base=excluded.volume_base,
    disagreement_class=excluded.disagreement_class,selection_reason=excluded.selection_reason
  WHERE ${PRICE_SELECTION_PREDICATE} AND (
    prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
    OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity
  )`;

// Each tier must remain RE-DERIVABLE at its own rank or it goes: a full-rank market_vwm row needs a
// liquidity-QUALIFIED edge in its freshness window (else it was priced under a laxer regime and the
// thin build re-labels it honestly next pass), a thin row needs any edge at all, and a transitional
// dex_vwm row is stale by definition. Runs BEFORE the builds so one crawl converges.
export const PRUNE_XCP_USD_SQL = `DELETE FROM prices
  WHERE currency='XCP' AND (
    source='dex_vwm'
    OR (source='market_vwm' AND NOT EXISTS (
      SELECT 1 FROM market_price_observations recent
      WHERE recent.day BETWEEN date(prices.day,'-${DERIVED_FRESH_DAYS} days') AND prices.day
        AND recent.base_currency='XCP' AND recent.quote_currency='BTC'
        AND recent.source='counterparty' AND recent.venue='market'
        AND recent.trades>=${MARKET_EDGE_MIN_TRADES} AND recent.volume_base>=${MARKET_EDGE_MIN_VOLUME_XCP}))
    OR (source='market_vwm_thin' AND NOT EXISTS (
      SELECT 1 FROM market_price_observations recent
      WHERE recent.day BETWEEN date(prices.day,'-${DERIVED_FRESH_DAYS} days') AND prices.day
        AND recent.base_currency='XCP' AND recent.quote_currency='BTC'
        AND recent.source='counterparty' AND recent.venue='market'))
  )`;

async function upsertPrices(db: D1Database, rows: PriceWrite[]) {
  for (let i = 0; i < rows.length; i += 100) {
    await db.batch(
      rows.slice(i, i + 100).map((row) =>
        db
          .prepare(
            `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity,policy_version,price_kind,age_days,
               derivation_depth,observation_count,venue_count,volume_base,disagreement_class,selection_reason)
             VALUES(?,?,?,?,?,?,'${PRICE_SELECTION_POLICY}',?,0,?,1,1,NULL,'not_evaluated',?)
             ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
               observed_day=excluded.observed_day,fidelity=excluded.fidelity,policy_version=excluded.policy_version,
               price_kind=excluded.price_kind,age_days=excluded.age_days,derivation_depth=excluded.derivation_depth,
               observation_count=excluded.observation_count,venue_count=excluded.venue_count,
               volume_base=excluded.volume_base,disagreement_class=excluded.disagreement_class,
               selection_reason=excluded.selection_reason
             WHERE ${PRICE_SELECTION_PREDICATE} AND (
               prices.usd IS NOT excluded.usd OR prices.source IS NOT excluded.source
               OR prices.observed_day IS NOT excluded.observed_day OR prices.fidelity IS NOT excluded.fidelity
             )`,
          )
          .bind(
            row.day,
            row.currency,
            row.usd,
            row.source,
            row.observedDay,
            row.fidelity,
            row.priceKind,
            row.derivationDepth,
            row.selectionReason,
          ),
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
          priceKind: "direct" as const,
          derivationDepth: 0,
          selectionReason: "primary_daily_close",
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
  const dispenseUpsert = await env.CORE_DB.prepare(BUILD_DISPENSE_PRICE_OBSERVATIONS_SQL).run();
  const dispensePrune = await env.CORE_DB.prepare(PRUNE_DISPENSE_PRICE_OBSERVATIONS_SQL).run();
  const marketUpsert = await env.CORE_DB.prepare(BUILD_MARKET_PRICE_OBSERVATIONS_SQL).run();
  const marketPrune = await env.CORE_DB.prepare(PRUNE_MARKET_PRICE_OBSERVATIONS_SQL).run();
  const burnUpsert = await env.CORE_DB.prepare(BUILD_BURN_PRICE_OBSERVATIONS_SQL).run();
  const burnPrune = await env.CORE_DB.prepare(PRUNE_BURN_PRICE_OBSERVATIONS_SQL).run();

  const observedUsdUpsert = await env.CORE_DB.prepare(BUILD_OBSERVED_USD_SQL).run();
  const observedUsdPrune = await env.CORE_DB.prepare(PRUNE_OBSERVED_USD_SQL).run();
  const burnXcpUsdUpsert = await env.CORE_DB.prepare(BUILD_BURN_XCP_USD_SQL).run();
  const burnXcpUsdPrune = await env.CORE_DB.prepare(PRUNE_BURN_XCP_USD_SQL).run();
  const zaifXcpUsdPrune = await env.CORE_DB.prepare(PRUNE_ZAIF_XCP_USD_SQL).run();
  const zaifXcpUsdUpsert = await env.CORE_DB.prepare(BUILD_ZAIF_XCP_USD_SQL).run();
  const xcpUsdPrune = await env.CORE_DB.prepare(PRUNE_XCP_USD_SQL).run();
  const xcpUsdUpsert = await env.CORE_DB.prepare(BUILD_XCP_USD_SQL).run();
  const thinXcpUsdUpsert = await env.CORE_DB.prepare(BUILD_THIN_XCP_USD_SQL).run();
  out.derived = {
    xcp_btc_upserted: xcpBtcUpsert.meta.rows_written ?? 0,
    xcp_btc_pruned: xcpBtcPrune.meta.rows_written ?? 0,
    dispense_upserted: dispenseUpsert.meta.rows_written ?? 0,
    dispense_pruned: dispensePrune.meta.rows_written ?? 0,
    market_upserted: marketUpsert.meta.rows_written ?? 0,
    market_pruned: marketPrune.meta.rows_written ?? 0,
    burn_xcp_btc_upserted: burnUpsert.meta.rows_written ?? 0,
    burn_xcp_btc_pruned: burnPrune.meta.rows_written ?? 0,
    observed_usd_upserted: observedUsdUpsert.meta.rows_written ?? 0,
    observed_usd_pruned: observedUsdPrune.meta.rows_written ?? 0,
    burn_xcp_usd_upserted: burnXcpUsdUpsert.meta.rows_written ?? 0,
    burn_xcp_usd_pruned: burnXcpUsdPrune.meta.rows_written ?? 0,
    zaif_xcp_usd_upserted: zaifXcpUsdUpsert.meta.rows_written ?? 0,
    zaif_xcp_usd_pruned: zaifXcpUsdPrune.meta.rows_written ?? 0,
    xcp_usd_upserted: xcpUsdUpsert.meta.rows_written ?? 0,
    thin_xcp_usd_upserted: thinXcpUsdUpsert.meta.rows_written ?? 0,
    xcp_usd_pruned: xcpUsdPrune.meta.rows_written ?? 0,
  };

  const c = await env.CORE_DB.prepare(
    `SELECT currency, COUNT(*) n, MIN(day) lo, MAX(day) hi FROM prices GROUP BY currency`,
  ).all();
  // Calendar changes can correct any historical day, so schedule exactly one bounded full reconciliation.
  // Between daily refreshes the monotonic cursor prices only newly appended trades and then stays caught up.
  await setCoreState(env.CORE_DB, "usd_cur", 0);
  // Force a new health snapshot only after that reconciliation reaches the tip; the prior snapshot describes
  // the calendar version that was just superseded.
  await setCoreState(env.CORE_DB, "pricing_health_day", 0);
  out.calendar = c.results ?? [];
  return out;
}

const USD_WINDOW = 200_000; // rows per apply call (rowid-windowed — contiguous across venues)

export const REFRESH_PRICING_HEALTH_SQL = `INSERT INTO pricing_health(
    currency,trades,missing,divergent,latest_price_day,latest_price_source,latest_observed_day,generated_at)
  WITH currencies(currency) AS (VALUES('BTC'),('ETH'),('XCP'),('USDC')),
  trade_health AS (
    SELECT trade.currency,COUNT(*) trades,SUM(trade.usd_value IS NULL) missing,
      SUM(CASE
        WHEN trade.currency='USDC' THEN trade.usd_value IS NOT trade.total
        WHEN price.usd IS NULL THEN trade.usd_value IS NOT NULL
        ELSE trade.usd_value IS NOT trade.total*price.usd
      END) divergent
    FROM trades trade LEFT JOIN prices price
      ON price.currency=trade.currency AND price.day=date(trade.block_time,'unixepoch')
    WHERE trade.currency IN ('BTC','ETH','XCP','USDC') GROUP BY trade.currency
  ), latest AS (
    SELECT price.currency,price.day,price.source,price.observed_day,
      ROW_NUMBER() OVER(PARTITION BY price.currency ORDER BY price.day DESC) rank
    FROM prices price
  )
  SELECT currencies.currency,COALESCE(trade_health.trades,0),COALESCE(trade_health.missing,0),
    COALESCE(trade_health.divergent,0),latest.day,latest.source,latest.observed_day,?
  FROM currencies LEFT JOIN trade_health USING(currency)
  LEFT JOIN latest ON latest.currency=currencies.currency AND latest.rank=1
  ON CONFLICT(currency) DO UPDATE SET trades=excluded.trades,missing=excluded.missing,
    divergent=excluded.divergent,latest_price_day=excluded.latest_price_day,
    latest_price_source=excluded.latest_price_source,latest_observed_day=excluded.latest_observed_day,
    generated_at=excluded.generated_at`;

async function maybeRefreshPricingHealth(db: D1Database, now: number) {
  const day = isoDay(now);
  const refreshedDay = await getCoreStateInt(db, "pricing_health_day");
  const dayNumber = Math.floor(now / DAY);
  if (refreshedDay === dayNumber) return false;
  await db.prepare(REFRESH_PRICING_HEALTH_SQL).bind(now).run();
  await setCoreState(db, "pricing_health_day", dayNumber);
  return day;
}

export function tradeUsdWindow(cursor: number, tip: number): { from: number; to: number } | null {
  return cursor >= tip ? null : { from: cursor, to: Math.min(cursor + USD_WINDOW, tip) };
}

export const APPLY_TRADE_USD_SQL = `UPDATE trades SET usd_value=total*(
    SELECT price.usd FROM prices price
    WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))
  WHERE currency NOT IN ('USD','USDC') AND rowid>? AND rowid<=?
    AND usd_value IS NOT total*(SELECT price.usd FROM prices price
      WHERE price.currency=trades.currency AND price.day=date(trades.block_time,'unixepoch'))`;

/** Reconcile the daily-reset history or newly appended rows, then remain idle when caught up. */
export async function applyTradeUsd(env: Env): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1000);
  const tip = Number((await env.CORE_DB.prepare(`SELECT MAX(rowid) m FROM trades`).first<{ m: number }>())?.m) || 0;
  const cur = await getCoreStateInt(env.CORE_DB, "usd_cur");
  const window = tradeUsdWindow(cur, tip);
  if (!window) {
    const pricing_health_day = await maybeRefreshPricingHealth(env.CORE_DB, now);
    return { from: cur, to: cur, tip, priced_rows: 0, done: true, pricing_health_day };
  }
  const hi = window.to;
  const result = await env.CORE_DB.prepare(APPLY_TRADE_USD_SQL).bind(cur, hi).run();
  await setCoreState(env.CORE_DB, "usd_cur", hi);
  const pricing_health_day = hi >= tip ? await maybeRefreshPricingHealth(env.CORE_DB, now) : false;
  return { from: cur, to: hi, tip, priced_rows: result.meta.rows_written ?? 0, done: hi >= tip, pricing_health_day };
}
