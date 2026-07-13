/**
 * Daily USD price feed + trade USD backfill. Fills `trades.usd_value` so the unified sales stream is comparable
 * in dollars across venues (XCP/BTC/ETH), on top of the USDC rows already priced at ingest.
 *
 *   BTC/USD, ETH/USD  ← Coinbase Exchange daily candles (no key; resumable backfill to 2015/2016)
 *   XCP/USD           ← per-day VWAP XCP/BTC from our own DEX order_matches (forward-filled) × BTC/USD
 *
 * `prices(day, currency, usd)` is the calendar; `applyTradeUsd` maps each trade's day+currency onto it.
 */
import type { Env } from "#api/env";
import { fetchCoinbaseCandles } from "#api/integrations/coinbase";
import { getIndexerStateInt as getState, setIndexerState as setState } from "#api/indexer/state";

export const PRICES_DDL = `CREATE TABLE IF NOT EXISTS prices (
  day TEXT NOT NULL, currency TEXT NOT NULL, usd REAL, PRIMARY KEY (day, currency))`;
const PRICES_IDX = `CREATE INDEX IF NOT EXISTS idx_prices_cur_day ON prices(currency, day)`;
const XCP_BTC_DDL = `CREATE TABLE IF NOT EXISTS xcp_btc_daily (day TEXT PRIMARY KEY, xcpbtc REAL NOT NULL)`;

// Coinbase product + first-listed day (unix sec) per currency.
const COINS: Record<string, { product: string; start: number }> = {
  BTC: { product: "BTC-USD", start: 1437350400 }, // 2015-07-20
  ETH: { product: "ETH-USD", start: 1463529600 }, // 2016-05-18
};
const DAY = 86400;
const WIN = 300 * DAY; // Coinbase caps candles at 300/request
const WINDOWS_PER_CALL = 8; // ~2400 days per currency per admin call → backfills in ~2 passes

const isoDay = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

// One Coinbase window: [[time, low, high, open, close, volume], ...] (close = index 4).
async function cbWindow(product: string, start: number, end: number) {
  return fetchCoinbaseCandles(product, start, end, DAY);
}

/** Backfill BTC/ETH from Coinbase (resumable per-currency cursor), then re-derive XCP from our DEX × BTC. */
export async function crawlPrices(env: Env): Promise<Record<string, unknown>> {
  await env.DB.prepare(PRICES_DDL).run();
  await env.DB.prepare(PRICES_IDX).run();
  await env.DB.prepare(XCP_BTC_DDL).run();
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, unknown> = {};

  for (const [cur, cfg] of Object.entries(COINS)) {
    let cursor = (await getState(env.DB, `prices_cur_${cur}`)) || cfg.start;
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
        const stmts = rows.map((r) =>
          env.DB.prepare(
            `INSERT INTO prices (day,currency,usd) VALUES (?,?,?)
             ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd`,
          ).bind(isoDay(r.time), cur, r.close),
        );
        for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
        filled += rows.length;
      }
      cursor = end;
    }
    // don't pin the cursor at `now` while backfilling incompletely; leave a 2-day lip so the tail refreshes
    await setState(env.DB, `prices_cur_${cur}`, Math.min(cursor, now - 2 * DAY));
    out[cur] = filled;
  }

  // Fold order matches once into a tiny indexed daily series. The former non-materialized CTE was searched
  // twice per BTC calendar day and D1 reported 8.3m rows read; this scans matches once, then seeks days.
  await env.DB.prepare(`DELETE FROM xcp_btc_daily`).run();
  await env.DB.prepare(
    `INSERT INTO xcp_btc_daily (day,xcpbtc)
    SELECT date(block_time,'unixepoch'),
      SUM(CASE WHEN forward_asset='BTC' THEN forward_quantity ELSE backward_quantity END) * 1.0
      / NULLIF(SUM(CASE WHEN forward_asset='XCP' THEN forward_quantity ELSE backward_quantity END), 0)
    FROM order_matches
    WHERE status='completed' AND ((forward_asset='XCP' AND backward_asset='BTC') OR (forward_asset='BTC' AND backward_asset='XCP'))
    GROUP BY date(block_time,'unixepoch')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO prices (day,currency,usd)
    SELECT b.day,'XCP',
      (SELECT x.xcpbtc FROM xcp_btc_daily x WHERE x.day<=b.day ORDER BY x.day DESC LIMIT 1)*b.usd
    FROM prices b WHERE b.currency='BTC'
      AND EXISTS (SELECT 1 FROM xcp_btc_daily x WHERE x.day<=b.day)
    ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd`,
  ).run();

  const c = await env.DB.prepare(
    `SELECT currency, COUNT(*) n, MIN(day) lo, MAX(day) hi FROM prices GROUP BY currency`,
  ).all();
  out.calendar = c.results ?? [];
  return out;
}

const USD_WINDOW = 200_000; // rows per apply call (rowid-windowed — contiguous across venues)

/** Map each (day, currency) trade onto the price calendar. Windowed by rowid (venue-agnostic and gap-free,
 *  unlike block_index which mixes Counterparty blocks with huge ETH block numbers). Leaves USDC (already set) and any
 *  day with no price untouched. Resumable via usd_cur; wraps to re-sweep for late prices / freshly added rows. */
export async function applyTradeUsd(env: Env): Promise<Record<string, unknown>> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(rowid) m FROM trades`).first<{ m: number }>())?.m) || 0;
  let cur = await getState(env.DB, "usd_cur");
  if (cur >= tip) cur = 0; // wrap: re-sweep for late-arriving prices / new NULLs
  const hi = Math.min(cur + USD_WINDOW, tip);
  const result = await env.DB.prepare(
    `
    UPDATE trades SET usd_value = total * (
      SELECT p.usd FROM prices p WHERE p.currency = trades.currency AND p.day = date(trades.block_time,'unixepoch'))
    WHERE currency IN ('BTC','ETH','XCP') AND usd_value IS NULL
      AND rowid > ? AND rowid <= ?
      AND EXISTS (SELECT 1 FROM prices p WHERE p.currency = trades.currency AND p.day = date(trades.block_time,'unixepoch'))
  `,
  )
    .bind(cur, hi)
    .run();
  await setState(env.DB, "usd_cur", hi);
  return { from: cur, to: hi, tip, priced_rows: result.meta.rows_written ?? 0, done: hi >= tip };
}
