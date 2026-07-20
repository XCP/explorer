/**
 * Trades queries — the only place that knows the `trades` table's SQL. Handlers call these and wrap
 * the result in the envelope; the row shape is the wire contract (@xcp/shared/trades).
 */
import type { RingCandidate, TradeRow, TradeVenueStats } from "@xcp/shared/trades";
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

/**
 * Ring-trade review candidates: unflagged assets whose priced volume concentrates in RECIPROCAL
 * address pairs — the RRAM pattern (a closed set of addresses passing an asset back and forth),
 * which neither the literal self-fill exclusion nor the >=50% self-trade heuristic can see.
 * Validated against ground truth: DIAMONDBOND scores 97% reciprocal, RRAM 81%, SCUDOCOIN 67%,
 * while organic markets separate hard (PEPECASH 6%, XCP 0%, each with thousands of participants).
 * This is EVIDENCE FOR HUMAN REVIEW, never an auto-flag input — an automatic threshold would let
 * a stranger wash-trade someone else's asset into a low-quality rating. The busiest reciprocal
 * pair ships with each row so the reviewer sees who did the round-tripping.
 */
export function ringCandidates(
  db: D1Database,
  minUsd = 1_000,
  minFills = 6,
  minPct = 20,
  limit = 50,
): Promise<RingCandidate[]> {
  return q<RingCandidate>(
    db,
    `WITH pair AS MATERIALIZED (
       SELECT asset_id, buyer_id, seller_id, SUM(usd_value) usd, COUNT(*) fills
       FROM trades
       WHERE buyer_id IS NOT NULL AND seller_id IS NOT NULL AND buyer_id<>seller_id
         AND usd_value>0 AND asset_id IS NOT NULL
       GROUP BY asset_id, buyer_id, seller_id
     ), duo AS (
       /* Unordered pair: 1 row per direction, so a group holds 1 or 2 rows. Reciprocal flow is the
          MATCHED amount, 2*MIN(direction usd) — an artist's one $25 buy-back against $5k of sales
          contributes $50, not the whole sale direction. A balanced ring still scores its full USD. */
       SELECT asset_id, MIN(buyer_id, seller_id) low_id, MAX(buyer_id, seller_id) high_id,
         SUM(usd) usd, SUM(fills) fills,
         CASE WHEN COUNT(*)=2 THEN 2*MIN(usd) ELSE 0 END matched_usd,
         CASE WHEN COUNT(*)=2 THEN 2*MIN(fills) ELSE 0 END matched_fills
       FROM pair GROUP BY asset_id, MIN(buyer_id, seller_id), MAX(buyer_id, seller_id)
     ), recip AS (
       SELECT asset_id, SUM(matched_usd) recip_usd, SUM(matched_fills) recip_fills
       FROM duo GROUP BY asset_id
     ), top_duo AS (
       SELECT asset_id, low_id, high_id, usd, fills,
         ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY matched_usd DESC) rank_in_asset
       FROM duo WHERE matched_usd>0
     ), total AS (
       SELECT asset_id, SUM(usd) usd, SUM(fills) fills FROM pair GROUP BY asset_id
     ), participant AS (
       SELECT asset_id, COUNT(DISTINCT party) participants FROM (
         SELECT asset_id, buyer_id party FROM pair UNION SELECT asset_id, seller_id FROM pair
       ) GROUP BY asset_id
     )
     SELECT dictionary.asset,
       ROUND(total.usd) usd, total.fills,
       ROUND(recip.recip_usd) recip_usd, recip.recip_fills,
       ROUND(100.0*recip.recip_usd/total.usd, 1) recip_pct,
       participant.participants,
       ROUND(top_duo.usd) top_pair_usd, top_duo.fills top_pair_fills,
       party_a.address top_pair_a, party_b.address top_pair_b
     FROM recip
     JOIN total ON total.asset_id=recip.asset_id
     JOIN participant ON participant.asset_id=recip.asset_id
     JOIN top_duo ON top_duo.asset_id=recip.asset_id AND top_duo.rank_in_asset=1
     JOIN asset_dictionary dictionary ON dictionary.asset_id=recip.asset_id
     JOIN address_dictionary party_a ON party_a.address_id=top_duo.low_id
     JOIN address_dictionary party_b ON party_b.address_id=top_duo.high_id
     LEFT JOIN asset_signals signal ON signal.asset_id=recip.asset_id
     WHERE COALESCE(signal.low_quality, 0)=0
       AND recip.recip_usd>=?1 AND recip.recip_fills>=?2
       AND 100.0*recip.recip_usd/total.usd>=?3
     ORDER BY recip.recip_usd DESC LIMIT ?4`,
    minUsd,
    minFills,
    minPct,
    limit,
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
