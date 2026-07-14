import type { TradeRow, TradeVenueStats } from "@xcp/shared/trades";
import { q } from "#api/db";
import type { TradeFilter } from "#api/queries/trades";

const SELECT = `SELECT trade.venue,asset.asset,trade.block_time,trade.block_index,trade.quantity,
  trade.currency,trade.total,trade.price,trade.usd_value,buyer.address buyer,seller.address seller,
  CASE WHEN trade.tx_hash IS NOT NULL THEN lower(hex(trade.tx_hash)) ELSE trade.external_tx_hash END tx_hash
  FROM trades trade
  LEFT JOIN asset_dictionary asset ON asset.asset_id=trade.asset_id
  LEFT JOIN address_dictionary buyer ON buyer.address_id=trade.buyer_id
  LEFT JOIN address_dictionary seller ON seller.address_id=trade.seller_id`;

export function listCoreTrades(db: D1Database, filter: TradeFilter): Promise<TradeRow[]> {
  const predicates: string[] = [];
  const binds: unknown[] = [];
  if (filter.venue) {
    predicates.push("trade.venue=?");
    binds.push(filter.venue);
  }
  if (filter.asset) {
    predicates.push("trade.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)");
    binds.push(filter.asset.toUpperCase());
  }
  if (filter.currency) {
    predicates.push("trade.currency=?");
    binds.push(filter.currency.toUpperCase());
  }
  const where = predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : "";
  return q<TradeRow>(
    db,
    `${SELECT} ${where} ORDER BY trade.block_time DESC LIMIT ? OFFSET ?`,
    ...binds,
    filter.limit,
    filter.offset,
  );
}

export function coreTradeVenueStats(db: D1Database): Promise<TradeVenueStats[]> {
  return q<TradeVenueStats>(
    db,
    `SELECT trade.venue,COUNT(*) trades,COUNT(DISTINCT trade.asset_id) assets,
            MAX(trade.block_time) last_time,SUM(trade.usd_value) usd_known
       FROM trades trade GROUP BY trade.venue`,
  );
}
