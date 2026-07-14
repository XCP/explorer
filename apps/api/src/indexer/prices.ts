/**
 * Daily USD price feed + trade USD backfill. Fills `trades.usd_value` so the unified sales stream is comparable
 * in dollars across venues (XCP/BTC/ETH), on top of the USDC rows already priced at ingest.
 *
 *   BTC/USD, ETH/USD  ← Coinbase Exchange daily candles (no key; resumable backfill to 2015/2016)
 *   XCP/USD           ← daily volume-weighted-median XCP/BTC, carried at most seven days × BTC/USD
 *
 * `prices(day, currency, usd)` is the calendar; `applyTradeUsd` maps each trade's day+currency onto it.
 */
import type { Env } from "#api/env";
import { fetchCoinbaseCandles } from "#api/integrations/coinbase";
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

const DERIVED_FRESH_DAYS = 7;

export const BUILD_XCP_BTC_DAILY_SQL = `INSERT INTO xcp_btc_daily(day,xcpbtc,volume_xcp,trades)
  WITH observations AS (
    SELECT date(match.block_time,'unixepoch') day,
      CASE WHEN forward_asset.asset='XCP'
        THEN CAST(match.backward_quantity AS REAL)/CAST(match.forward_quantity AS REAL)
        ELSE CAST(match.forward_quantity AS REAL)/CAST(match.backward_quantity AS REAL) END price,
      CASE WHEN forward_asset.asset='XCP' THEN CAST(match.forward_quantity AS INTEGER)
        ELSE CAST(match.backward_quantity AS INTEGER) END volume_xcp
    FROM order_matches match
    JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
    JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
    WHERE match.status='completed' AND CAST(match.forward_quantity AS INTEGER)>0
      AND CAST(match.backward_quantity AS INTEGER)>0
      AND ((forward_asset.asset='XCP' AND backward_asset.asset='BTC')
        OR (forward_asset.asset='BTC' AND backward_asset.asset='XCP'))
  ), ranked AS (
    SELECT day,price,volume_xcp,
      SUM(volume_xcp) OVER(PARTITION BY day ORDER BY price ROWS UNBOUNDED PRECEDING) cumulative_volume,
      SUM(volume_xcp) OVER(PARTITION BY day) total_volume,
      COUNT(*) OVER(PARTITION BY day) trades
    FROM observations
  )
  SELECT day,MIN(price),CAST(MAX(total_volume) AS TEXT),MAX(trades)
  FROM ranked WHERE cumulative_volume*2>=total_volume GROUP BY day`;

export const BUILD_XCP_USD_SQL = `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity)
  SELECT btc.day,'XCP',edge.xcpbtc*btc.usd,'dex_vwm',edge.day,1
  FROM prices btc
  JOIN xcp_btc_daily edge ON edge.day=(
    SELECT recent.day FROM xcp_btc_daily recent
    WHERE recent.day BETWEEN date(btc.day,'-${DERIVED_FRESH_DAYS} days') AND btc.day
    ORDER BY recent.day DESC LIMIT 1)
  WHERE btc.currency='BTC'
  ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
    observed_day=excluded.observed_day,fidelity=excluded.fidelity
  WHERE prices.fidelity<=excluded.fidelity`;

async function upsertPrices(db: D1Database, rows: PriceWrite[]) {
  for (let i = 0; i < rows.length; i += 100) {
    await db.batch(
      rows.slice(i, i + 100).map((row) =>
        db
          .prepare(
            `INSERT INTO prices(day,currency,usd,source,observed_day,fidelity) VALUES(?,?,?,?,?,?)
             ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source,
               observed_day=excluded.observed_day,fidelity=excluded.fidelity
             WHERE prices.fidelity<=excluded.fidelity`,
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
  await env.CORE_DB.prepare(`DELETE FROM xcp_btc_daily`).run();
  await env.CORE_DB.prepare(BUILD_XCP_BTC_DAILY_SQL).run();

  await env.CORE_DB.prepare(`DELETE FROM prices WHERE currency='XCP' AND source='dex_vwm'`).run();
  await env.CORE_DB.prepare(BUILD_XCP_USD_SQL).run();

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
