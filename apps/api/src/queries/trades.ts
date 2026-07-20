/**
 * Trades queries — the only place that knows the `trades` table's SQL. Handlers call these and wrap
 * the result in the envelope; the row shape is the wire contract (@xcp/shared/trades).
 */
import type { TradeRow, TradeVenueStats } from "@xcp/shared/trades";
import { q } from "#api/db";

const QUALITY = `(COALESCE(asset_signal.low_quality,0)=1
  OR COALESCE(currency_signal.low_quality,0)=1
  OR COALESCE(trade.sale_class,'') LIKE 'scam_%'
  OR EXISTS(SELECT 1 FROM trade_legs quality_leg
    JOIN asset_signals quality_signal ON quality_signal.asset_id=quality_leg.asset_id
    WHERE quality_leg.venue=trade.venue AND quality_leg.trade_ref=trade.ref AND quality_signal.low_quality=1))`;

const SELECT = `SELECT trade.venue,asset.asset,trade.block_time,trade.block_index,trade.quantity,
  trade.currency,trade.total,trade.price,
  trade.usd_value,
  CASE WHEN trade.usd_value IS NULL THEN NULL
    WHEN trade.currency IN ('USD','USDC') THEN 'direct_usd' ELSE 'execution_day' END usd_basis,
  CASE WHEN trade.usd_value IS NULL THEN NULL
    WHEN trade.currency='USD' THEN 'telegram_quote'
    WHEN trade.currency='USDC' THEN 'usdc_parity' ELSE selected_price.source END usd_source,
  CASE WHEN trade.usd_value IS NULL OR trade.currency IN ('USD','USDC') THEN NULL ELSE selected_price.day END usd_price_day,
  CASE WHEN trade.usd_value IS NULL OR trade.currency IN ('USD','USDC') THEN NULL ELSE selected_price.observed_day END usd_observed_day,
  CASE WHEN ${QUALITY} THEN 1 ELSE 0 END low_quality,
  buyer.address buyer,seller.address seller,
  CASE WHEN trade.tx_hash IS NOT NULL THEN lower(hex(trade.tx_hash)) ELSE trade.external_tx_hash END tx_hash,
  trade.sale_class,
  CASE WHEN trade.sale_class='bundle' THEN
    (SELECT COUNT(*) FROM trade_legs leg WHERE leg.venue=trade.venue AND leg.trade_ref=trade.ref)
    ELSE CASE WHEN trade.asset_id IS NULL THEN 0 ELSE 1 END END leg_count,
  COALESCE(telegram_sale.chat_name,swapbot.bot_slug) source_name,
  COALESCE(telegram_import.chat_url,swapbot.evidence_url) source_url
  FROM trades trade
  LEFT JOIN asset_dictionary asset ON asset.asset_id=trade.asset_id
  LEFT JOIN address_dictionary buyer ON buyer.address_id=trade.buyer_id
  LEFT JOIN address_dictionary seller ON seller.address_id=trade.seller_id
  LEFT JOIN asset_signals asset_signal ON asset_signal.asset_id=trade.asset_id
  LEFT JOIN asset_dictionary currency_asset ON currency_asset.asset=trade.currency
  LEFT JOIN asset_signals currency_signal ON currency_signal.asset_id=currency_asset.asset_id
  LEFT JOIN telegram_sales telegram_sale ON trade.venue='telegram'
    AND trade.ref=telegram_sale.chat_id||':'||telegram_sale.message_id
  LEFT JOIN telegram_imports telegram_import ON telegram_import.sha256=telegram_sale.import_sha256
  LEFT JOIN tokenly_swapbots swapbot ON trade.venue='tokenly_swapbot'
    AND swapbot.address=seller.address
  LEFT JOIN prices selected_price ON selected_price.currency=trade.currency
    AND selected_price.day=date(trade.block_time,'unixepoch')`;

export interface TradeFilter {
  venue?: string;
  asset?: string;
  currency?: string;
  limit: number;
  offset: number;
  includeLowQuality?: boolean;
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
    where.push(`(trade.asset_id = (SELECT asset_id FROM asset_dictionary WHERE asset = ?)
      OR EXISTS(SELECT 1 FROM trade_legs filter_leg JOIN asset_dictionary filter_asset ON filter_asset.asset_id=filter_leg.asset_id
        WHERE filter_leg.venue=trade.venue AND filter_leg.trade_ref=trade.ref AND filter_asset.asset=?))`);
    binds.push(f.asset.toUpperCase());
    binds.push(f.asset.toUpperCase());
  }
  if (f.currency) {
    where.push("trade.currency = ?");
    binds.push(f.currency.toUpperCase());
  }
  if (!f.includeLowQuality) where.push(`NOT ${QUALITY}`);
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
export function tradeVenueStats(db: D1Database, includeLowQuality = false): Promise<TradeVenueStats[]> {
  return q<TradeVenueStats>(
    db,
    `SELECT trade.venue, COUNT(*) trades, COUNT(DISTINCT trade.asset_id) assets,
            MAX(trade.block_time) last_time,
            SUM(CASE WHEN trade.buyer_id IS NOT NULL AND trade.buyer_id=trade.seller_id
                  THEN NULL ELSE trade.usd_value END) usd_known,
            SUM(CASE WHEN trade.usd_value IS NULL THEN 1 ELSE 0 END) usd_unpriced_trades,
            SUM(CASE WHEN ${QUALITY} THEN 1 ELSE 0 END) low_quality_trades
       FROM trades trade
       LEFT JOIN asset_signals asset_signal ON asset_signal.asset_id=trade.asset_id
       LEFT JOIN asset_dictionary currency_asset ON currency_asset.asset=trade.currency
       LEFT JOIN asset_signals currency_signal ON currency_signal.asset_id=currency_asset.asset_id
       ${includeLowQuality ? "" : `WHERE NOT ${QUALITY}`}
       GROUP BY trade.venue`,
  );
}
