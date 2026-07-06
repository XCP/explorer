/**
 * Trades queries — the only place that knows the `trades` table's SQL. Handlers call these and wrap
 * the result in the envelope; the row shape is the wire contract (@xcp/shared/trades).
 */
import type { TradeRow, TradeVenueStats } from "@xcp/shared/trades";
import { q } from "../db";

const COLS = `venue, asset, block_time, block_index, quantity, currency, total, price, usd_value, buyer, seller, tx_hash`;

export interface TradeFilter {
  venue?: string;
  asset?: string;
  currency?: string;
  limit: number;
  offset: number;
}

/** Recent trades across venues, newest first, with optional venue/asset/currency filters. */
export function listTrades(db: D1Database, f: TradeFilter): Promise<TradeRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.venue) { where.push("venue = ?"); binds.push(f.venue); }
  if (f.asset) { where.push("asset = ?"); binds.push(f.asset.toUpperCase()); }
  if (f.currency) { where.push("currency = ?"); binds.push(f.currency.toUpperCase()); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return q<TradeRow>(
    db,
    `SELECT ${COLS} FROM trades ${w} ORDER BY block_time DESC LIMIT ? OFFSET ?`,
    ...binds, f.limit, f.offset
  );
}

/** Per-venue totals for headers/tiles. */
export function tradeVenueStats(db: D1Database): Promise<TradeVenueStats[]> {
  return q<TradeVenueStats>(
    db,
    `SELECT venue, COUNT(*) trades, COUNT(DISTINCT asset) assets, MAX(block_time) last_time,
            SUM(usd_value) usd_known
     FROM trades GROUP BY venue`
  );
}
