/**
 * Record feed queries — the 21 generic recent-first index feeds, one per Counterparty RecordKind
 * (GET /v2/<kind>). Each feed is a fixed SELECT column list off its mirror table; every feed shares the
 * same `ORDER BY <col> DESC LIMIT ? OFFSET ?` tail. Rows pass through their SELECTed columns — the wire
 * contract for each feed is @xcp/shared/records, keyed by kind via RecordRowMap. Offset pagination only
 * (a short page ends the feed) so the UI never pays for a COUNT(*) over millions of rows.
 */
import type { RecordKind, RecordRowMap } from "@xcp/shared/records";
import { q } from "../db";

// orders with normalized give/get quantities (divisibility via join; XCP/BTC are always divisible even
// though they have no assets row). Powers the base/quote price math on the client. Aliases the orders
// table `o`, so its feed orders on o.block_index. Also reused by the per-asset orders tab (queries/assets).
export const ORDER_SELECT = `SELECT o.tx_hash,o.block_index,o.block_time,o.source,o.give_asset,o.get_asset,o.status,
  CAST(o.give_quantity AS REAL)/(CASE WHEN o.give_asset IN ('XCP','BTC') OR ga.divisible THEN 100000000.0 ELSE 1 END) give_quantity_normalized,
  CAST(o.get_quantity AS REAL)/(CASE WHEN o.get_asset IN ('XCP','BTC') OR gb.divisible THEN 100000000.0 ELSE 1 END) get_quantity_normalized
  FROM orders o LEFT JOIN assets ga ON ga.asset=o.give_asset LEFT JOIN assets gb ON gb.asset=o.get_asset`;

/** One record feed: its SELECT column list, plus the ORDER BY column when an aliased join needs qualifying. */
interface RecordFeed {
  select: string;
  orderCol?: string; // defaults to the bare block_index index
}

/** Every record feed's SELECT, keyed by kind (the Record<RecordKind,…> keeps this exhaustive). */
const FEEDS: Record<RecordKind, RecordFeed> = {
  transactions: { select: `SELECT tx_hash,tx_index,block_index,block_time,source,destination,btc_amount,fee,supported FROM transactions` },
  sends: { select: `SELECT tx_hash,block_index,block_time,source,destination,asset,quantity_normalized,send_type,status FROM sends` },
  issuances: { select: `SELECT tx_hash,block_index,block_time,asset,asset_longname,source,issuer,quantity_normalized,transfer,divisible,locked,description,status FROM issuances` },
  dispensers: { select: `SELECT tx_hash,block_index,block_time,source,asset,give_quantity_normalized,give_remaining_normalized,satoshirate,satoshirate_normalized,dispense_count,status FROM dispensers` },
  dispenses: { select: `SELECT tx_hash,block_index,block_time,source,destination,asset,dispense_quantity_normalized,dispenser_tx_hash FROM dispenses` },
  orders: { select: ORDER_SELECT, orderCol: "o.block_index" },
  order_matches: { select: `SELECT id,block_index,block_time,tx0_hash,tx1_hash,tx0_address,tx1_address,forward_asset,forward_quantity,backward_asset,backward_quantity,status FROM order_matches` },
  sweeps: { select: `SELECT tx_hash,block_index,block_time,source,destination,flags,memo,fee_paid,status FROM sweeps` },
  fairminters: { select: `SELECT tx_hash,block_index,block_time,source,asset,asset_longname,price,hard_cap,soft_cap,divisible,earned_quantity,paid_quantity,status FROM fairminters` },
  fairmints: { select: `SELECT tx_hash,block_index,block_time,source,fairminter_tx_hash,asset,earn_quantity,paid_quantity,status FROM fairmints` },
  destructions: { select: `SELECT tx_hash,block_index,block_time,source,asset,quantity_normalized,tag,status FROM destructions` },
  burns: { select: `SELECT tx_hash,block_index,block_time,source,burned_normalized,earned_normalized,status FROM burns` },
  dividends: { select: `SELECT tx_hash,block_index,block_time,source,asset,dividend_asset,quantity_per_unit_normalized,status FROM dividends` },
  broadcasts: { select: `SELECT tx_hash,block_index,block_time,source,timestamp,value,text,locked,mime_type,status FROM broadcasts` },
  btcpays: { select: `SELECT tx_hash,block_index,block_time,source,destination,order_match_id,btc_amount_normalized,status FROM btcpays` },
  bets: { select: `SELECT tx_hash,block_index,block_time,source,feed_address,bet_type,deadline,wager_quantity,counterwager_quantity,target_value,leverage,status FROM bets` },
  bet_matches: { select: `SELECT id,block_index,block_time,tx0_address,tx1_address,feed_address,forward_quantity,backward_quantity,status FROM bet_matches` },
  rps: { select: `SELECT tx_hash,block_index,block_time,source,possible_moves,wager,expiration,status FROM rps` },
  rps_matches: { select: `SELECT id,block_index,block_time,tx0_address,tx1_address,possible_moves,wager,status FROM rps_matches` },
  pools: { select: `SELECT lp_asset,pair,asset_a,asset_b,reserve_a,reserve_b,lp_supply,price,status,block_index FROM pools` },
  pool_matches: { select: `SELECT tx_hash,block_index,block_time,source,lp_asset,pair,forward_asset,forward_quantity,backward_asset,backward_quantity FROM pool_matches` },
};

/**
 * Run one record feed by kind: append the shared recent-first / pagination tail to its SELECT. The row
 * type is the kind's wire row (RecordRowMap[K]); the orders feed orders on its aliased o.block_index.
 */
export function listRecords<K extends RecordKind>(
  db: D1Database,
  kind: K,
  limit: number,
  offset: number
): Promise<RecordRowMap[K][]> {
  const feed = FEEDS[kind];
  return q<RecordRowMap[K]>(
    db,
    `${feed.select} ORDER BY ${feed.orderCol ?? "block_index"} DESC LIMIT ? OFFSET ?`,
    limit,
    offset
  );
}
