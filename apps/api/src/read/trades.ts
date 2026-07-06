/**
 * Unified trades/sales read surface — a flat read over the materialized `trades` ledger (no runtime union).
 *   GET /v2/trades                 recent trades across all venues (?venue=, ?asset=, ?currency=, limit/offset)
 *   GET /v2/assets/:asset/trades   one card's full sales history
 *   GET /v2/trades/stats           venue counts + totals (for headers/tiles)
 * `price` is a generated column (total/quantity); `usd_value` is present where known (USDC now, more later).
 */
import { router, cached, lim, off } from "./shared";

const COLS = `venue, asset, block_time, block_index, quantity, currency, total, price, usd_value, buyer, seller, tx_hash`;

export const trades = router();

trades.get("/v2/trades", async (c) => {
  const limit = lim(c, 50, 200);
  const offset = off(c);
  const venue = c.req.query("venue");
  const asset = c.req.query("asset");
  const currency = c.req.query("currency");
  const where: string[] = [];
  const bind: any[] = [];
  if (venue) { where.push("venue = ?"); bind.push(venue); }
  if (asset) { where.push("asset = ?"); bind.push(asset.toUpperCase()); }
  if (currency) { where.push("currency = ?"); bind.push(currency.toUpperCase()); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `SELECT ${COLS} FROM trades ${w} ORDER BY block_time DESC LIMIT ? OFFSET ?`;
  const key = `trades:${venue || ""}:${asset || ""}:${currency || ""}:${limit}:${offset}`;
  return cached(c, key, { ttl: 30 }, async () => {
    const r = await c.env.DB.prepare(sql).bind(...bind, limit, offset).all();
    return { trades: r.results ?? [] };
  });
});

trades.get("/v2/assets/:asset/trades", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const limit = lim(c, 50, 200);
  const offset = off(c);
  return cached(c, `asset-trades:${asset}:${limit}:${offset}`, { ttl: 30 }, async () => {
    const r = await c.env.DB.prepare(
      `SELECT ${COLS} FROM trades WHERE asset = ? ORDER BY block_time DESC LIMIT ? OFFSET ?`
    ).bind(asset, limit, offset).all();
    return { asset, trades: r.results ?? [] };
  });
});

trades.get("/v2/trades/stats", async (c) => {
  return cached(c, "trades:stats", { ttl: 120 }, async () => {
    const r = await c.env.DB.prepare(
      `SELECT venue, COUNT(*) trades, COUNT(DISTINCT asset) assets, MAX(block_time) last_time,
              SUM(usd_value) usd_known FROM trades GROUP BY venue`
    ).all();
    return { venues: r.results ?? [] };
  });
});
