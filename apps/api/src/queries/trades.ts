/**
 * Trades queries — the only place that knows the `trades` table's SQL. Handlers call these and wrap
 * the result in the envelope; the row shape is the wire contract (@xcp/shared/trades).
 */
import type { TradeRow, TradeVenueStats } from "@xcp/shared/trades";
import { q } from "#api/db";

const SELECT = `SELECT trade.venue,asset.asset,trade.block_time,trade.block_index,trade.quantity,
  trade.currency,trade.total,trade.price,trade.usd_value,buyer.address buyer,seller.address seller,
  CASE WHEN trade.tx_hash IS NOT NULL THEN lower(hex(trade.tx_hash)) ELSE trade.external_tx_hash END tx_hash
  FROM trades trade
  LEFT JOIN asset_dictionary asset ON asset.asset_id=trade.asset_id
  LEFT JOIN address_dictionary buyer ON buyer.address_id=trade.buyer_id
  LEFT JOIN address_dictionary seller ON seller.address_id=trade.seller_id`;

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
  if (f.venue) {
    where.push("trade.venue = ?");
    binds.push(f.venue);
  }
  if (f.asset) {
    where.push("trade.asset_id = (SELECT asset_id FROM asset_dictionary WHERE asset = ?)");
    binds.push(f.asset.toUpperCase());
  }
  if (f.currency) {
    where.push("trade.currency = ?");
    binds.push(f.currency.toUpperCase());
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return q<TradeRow>(
    db,
    `${SELECT} ${w} ORDER BY trade.block_time DESC, trade.venue, trade.ref LIMIT ? OFFSET ?`,
    ...binds,
    f.limit,
    f.offset,
  );
}

/** Per-venue totals for headers/tiles. */
export function tradeVenueStats(db: D1Database): Promise<TradeVenueStats[]> {
  return q<TradeVenueStats>(
    db,
    `SELECT trade.venue, COUNT(*) trades, COUNT(DISTINCT trade.asset_id) assets,
            MAX(trade.block_time) last_time, SUM(trade.usd_value) usd_known
       FROM trades trade GROUP BY trade.venue`,
  );
}
