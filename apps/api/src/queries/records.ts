/**
 * Record feed queries — the 21 generic recent-first index feeds, one per Counterparty RecordKind
 * (GET /v2/<kind>). Each feed is a fixed SELECT column list off its mirror table; every feed shares the
 * same `ORDER BY <col> DESC LIMIT ? OFFSET ?` tail. Rows pass through their SELECTed columns — the wire
 * contract for each feed is @xcp/shared/records, keyed by kind via RecordRowMap. Offset pagination only
 * (a short page ends the feed) so the UI never pays for a COUNT(*) over millions of rows.
 */
import type { RecordKind, RecordRowMap, CancelRow, DispenserRefillRow, PoolLiquidityRow } from "@xcp/shared/records";
import { q, one } from "#api/db";

const TRANSACTION_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM transactions ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(tx.tx_hash)) tx_hash,tx.tx_index,tx.block_index,tx.block_time,
  source.address source,destination.address destination,tx.btc_amount,tx.fee,tx.supported
FROM page JOIN transactions tx ON tx.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=tx.source_id
LEFT JOIN address_dictionary destination ON destination.address_id=tx.destination_id
ORDER BY tx.block_index DESC,tx.tx_index DESC`;

const SEND_FEED_SQL = `SELECT LOWER(HEX(send.tx_hash)) tx_hash,send.block_index,send.block_time,
  source.address source,destination.address destination,asset.asset,send.quantity_normalized,
  send.send_type,send.status,send.memo
FROM sends send
LEFT JOIN address_dictionary source ON source.address_id=send.source_id
LEFT JOIN address_dictionary destination ON destination.address_id=send.destination_id
LEFT JOIN asset_dictionary asset ON asset.asset_id=send.asset_id
ORDER BY send.block_index DESC,send.event_index DESC LIMIT ? OFFSET ?`;

const ISSUANCE_FEED_SQL = `WITH page AS (
  SELECT event_index FROM issuances ORDER BY block_index DESC,event_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(issuance.tx_hash)) tx_hash,issuance.block_index,issuance.block_time,
  asset.asset,issuance.asset_longname,source.address source,issuer.address issuer,issuance.quantity_normalized,
  issuance.transfer,issuance.divisible,issuance.locked,issuance.description,issuance.asset_events,issuance.status
FROM page JOIN issuances issuance ON issuance.event_index=page.event_index
LEFT JOIN asset_dictionary asset ON asset.asset_id=issuance.asset_id
LEFT JOIN address_dictionary source ON source.address_id=issuance.source_id
LEFT JOIN address_dictionary issuer ON issuer.address_id=issuance.issuer_id
ORDER BY issuance.block_index DESC,issuance.event_index DESC`;

const DISPENSER_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM dispensers ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(dispenser.tx_hash)) tx_hash,dispenser.block_index,dispenser.block_time,
  source.address source,asset.asset,dispenser.give_quantity_normalized,dispenser.give_remaining_normalized,
  dispenser.satoshirate,dispenser.satoshirate_normalized,dispenser.dispense_count,dispenser.status,
  dispenser.escrow_quantity,dispenser.closed_block_index
FROM page JOIN dispensers dispenser ON dispenser.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=dispenser.source_id
LEFT JOIN asset_dictionary asset ON asset.asset_id=dispenser.asset_id
ORDER BY dispenser.block_index DESC,dispenser.tx_index DESC`;

const DISPENSE_FEED_SQL = `WITH page AS (
  SELECT event_index FROM dispenses ORDER BY block_index DESC,event_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(dispense.tx_hash)) tx_hash,dispense.block_index,dispense.block_time,
  source.address source,destination.address destination,asset.asset,dispense.dispense_quantity_normalized,
  LOWER(HEX(parent.tx_hash)) dispenser_tx_hash,dispense.btc_amount,trade.usd_value
FROM page JOIN dispenses dispense ON dispense.event_index=page.event_index
LEFT JOIN address_dictionary source ON source.address_id=dispense.source_id
LEFT JOIN address_dictionary destination ON destination.address_id=dispense.destination_id
LEFT JOIN asset_dictionary asset ON asset.asset_id=dispense.asset_id
LEFT JOIN dispensers parent ON parent.tx_index=dispense.dispenser_tx_index
LEFT JOIN trades trade ON trade.venue='dispense' AND trade.ref=CAST(dispense.dispense_id AS TEXT)
ORDER BY dispense.block_index DESC,dispense.event_index DESC`;

const SWEEP_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM sweeps ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(sweep.tx_hash)) tx_hash,sweep.block_index,sweep.block_time,source.address source,
  destination.address destination,sweep.flags,sweep.memo,sweep.fee_paid,sweep.status
FROM page JOIN sweeps sweep ON sweep.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=sweep.source_id
LEFT JOIN address_dictionary destination ON destination.address_id=sweep.destination_id
ORDER BY sweep.block_index DESC,sweep.tx_index DESC`;

const DESTRUCTION_FEED_SQL = `WITH page AS (
  SELECT event_index FROM destructions ORDER BY block_index DESC,event_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(destruction.tx_hash)) tx_hash,destruction.block_index,destruction.block_time,
  source.address source,asset.asset,destruction.quantity_normalized,destruction.tag,destruction.status
FROM page JOIN destructions destruction ON destruction.event_index=page.event_index
LEFT JOIN address_dictionary source ON source.address_id=destruction.source_id
LEFT JOIN asset_dictionary asset ON asset.asset_id=destruction.asset_id
ORDER BY destruction.block_index DESC,destruction.event_index DESC`;

const BURN_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM burns ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(burn.tx_hash)) tx_hash,burn.block_index,burn.block_time,source.address source,
  burn.burned_normalized,burn.earned_normalized,burn.status
FROM page JOIN burns burn ON burn.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=burn.source_id
ORDER BY burn.block_index DESC,burn.tx_index DESC`;

const DIVIDEND_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM dividends ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(dividend.tx_hash)) tx_hash,dividend.block_index,dividend.block_time,source.address source,
  asset.asset,dividend_asset.asset dividend_asset,dividend.quantity_per_unit_normalized,dividend.status
FROM page JOIN dividends dividend ON dividend.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=dividend.source_id
LEFT JOIN asset_dictionary asset ON asset.asset_id=dividend.asset_id
LEFT JOIN asset_dictionary dividend_asset ON dividend_asset.asset_id=dividend.dividend_asset_id
ORDER BY dividend.block_index DESC,dividend.tx_index DESC`;

const BROADCAST_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM broadcasts ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(broadcast.tx_hash)) tx_hash,broadcast.block_index,broadcast.block_time,
  source.address source,broadcast.timestamp,broadcast.value,broadcast.text,broadcast.locked,
  broadcast.mime_type,broadcast.status
FROM page JOIN broadcasts broadcast ON broadcast.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=broadcast.source_id
ORDER BY broadcast.block_index DESC,broadcast.tx_index DESC`;

const FAIRMINTER_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM fairminters ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(fairminter.tx_hash)) tx_hash,fairminter.block_index,fairminter.block_time,
  source.address source,asset.asset,fairminter.asset_longname,fairminter.price,
  fairminter.quantity_by_price,fairminter.hard_cap,fairminter.soft_cap,fairminter.pool_quantity,
  fairminter.lp_asset,fairminter.divisible,fairminter.earned_quantity,fairminter.paid_quantity,
  fairminter.status
FROM page JOIN fairminters fairminter ON fairminter.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=fairminter.source_id
LEFT JOIN asset_dictionary asset ON asset.asset_id=fairminter.asset_id
ORDER BY fairminter.block_index DESC,fairminter.tx_index DESC`;

const FAIRMINT_FEED_SQL = `WITH page AS (
  SELECT event_index FROM fairmints ORDER BY block_index DESC,event_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(fairmint.tx_hash)) tx_hash,fairmint.block_index,fairmint.block_time,
  source.address source,LOWER(HEX(fairminter.tx_hash)) fairminter_tx_hash,asset.asset,
  fairmint.earn_quantity,fairmint.paid_quantity,COALESCE(asset_state.divisible,0) divisible,
  fairmint.status
FROM page JOIN fairmints fairmint ON fairmint.event_index=page.event_index
LEFT JOIN address_dictionary source ON source.address_id=fairmint.source_id
LEFT JOIN fairminters fairminter ON fairminter.tx_index=fairmint.fairminter_tx_index
LEFT JOIN asset_dictionary asset ON asset.asset_id=fairmint.asset_id
LEFT JOIN assets asset_state ON asset_state.asset_id=fairmint.asset_id
ORDER BY fairmint.block_index DESC,fairmint.event_index DESC`;

const BTCPAY_FEED_SQL = `WITH page AS (
  SELECT event_index FROM btcpays ORDER BY block_index DESC,event_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(btcpay.tx_hash)) tx_hash,btcpay.block_index,btcpay.block_time,
  source.address source,destination.address destination,
  LOWER(HEX(match.tx0_hash)||'_'||HEX(match.tx1_hash)) order_match_id,
  btcpay.btc_amount_normalized,btcpay.status
FROM page JOIN btcpays btcpay ON btcpay.event_index=page.event_index
LEFT JOIN address_dictionary source ON source.address_id=btcpay.source_id
LEFT JOIN address_dictionary destination ON destination.address_id=btcpay.destination_id
LEFT JOIN order_matches match ON match.tx0_index=btcpay.order_match_tx0_index
  AND match.tx1_index=btcpay.order_match_tx1_index
ORDER BY btcpay.block_index DESC,btcpay.event_index DESC`;

const BET_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM bets ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(bet.tx_hash)) tx_hash,bet.block_index,bet.block_time,source.address source,
  feed.address feed_address,bet.bet_type,bet.deadline,bet.wager_quantity,bet.counterwager_quantity,
  bet.target_value,bet.leverage,bet.status
FROM page JOIN bets bet ON bet.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=bet.source_id
LEFT JOIN address_dictionary feed ON feed.address_id=bet.feed_address_id
ORDER BY bet.block_index DESC,bet.tx_index DESC`;

const BET_MATCH_FEED_SQL = `WITH page AS (
  SELECT tx0_index,tx1_index FROM bet_matches
  ORDER BY block_index DESC,tx0_index DESC,tx1_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(match.tx0_hash)||'_'||HEX(match.tx1_hash)) id,match.block_index,match.block_time,
  tx0.address tx0_address,tx1.address tx1_address,feed.address feed_address,
  match.forward_quantity,match.backward_quantity,match.status
FROM page JOIN bet_matches match ON match.tx0_index=page.tx0_index AND match.tx1_index=page.tx1_index
LEFT JOIN address_dictionary tx0 ON tx0.address_id=match.tx0_address_id
LEFT JOIN address_dictionary tx1 ON tx1.address_id=match.tx1_address_id
LEFT JOIN address_dictionary feed ON feed.address_id=match.feed_address_id
ORDER BY match.block_index DESC,match.tx0_index DESC,match.tx1_index DESC`;

const RPS_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM rps ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(rps.tx_hash)) tx_hash,rps.block_index,rps.block_time,source.address source,
  rps.possible_moves,rps.wager,rps.expiration,rps.status
FROM page JOIN rps ON rps.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=rps.source_id
ORDER BY rps.block_index DESC,rps.tx_index DESC`;

const RPS_MATCH_FEED_SQL = `WITH page AS (
  SELECT tx0_index,tx1_index FROM rps_matches
  ORDER BY block_index DESC,tx0_index DESC,tx1_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(match.tx0_hash)||'_'||HEX(match.tx1_hash)) id,match.block_index,match.block_time,
  tx0.address tx0_address,tx1.address tx1_address,match.possible_moves,match.wager,match.status
FROM page JOIN rps_matches match ON match.tx0_index=page.tx0_index AND match.tx1_index=page.tx1_index
LEFT JOIN address_dictionary tx0 ON tx0.address_id=match.tx0_address_id
LEFT JOIN address_dictionary tx1 ON tx1.address_id=match.tx1_address_id
ORDER BY match.block_index DESC,match.tx0_index DESC,match.tx1_index DESC`;

const POOL_FEED_SQL = `WITH page AS (
  SELECT asset_a_id,asset_b_id FROM pools
  ORDER BY block_index DESC,asset_a_id DESC,asset_b_id DESC LIMIT ? OFFSET ?
)
SELECT pool.lp_asset,pool.pair,asset_a.asset asset_a,asset_b.asset asset_b,pool.reserve_a,
  pool.reserve_b,pool.lp_supply,pool.price,pool.status,pool.block_index
FROM page JOIN pools pool ON pool.asset_a_id=page.asset_a_id AND pool.asset_b_id=page.asset_b_id
LEFT JOIN asset_dictionary asset_a ON asset_a.asset_id=pool.asset_a_id
LEFT JOIN asset_dictionary asset_b ON asset_b.asset_id=pool.asset_b_id
ORDER BY pool.block_index DESC,pool.asset_a_id DESC,pool.asset_b_id DESC`;

const POOL_MATCH_FEED_SQL = `WITH page AS (
  SELECT event_index FROM pool_matches ORDER BY block_index DESC,event_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(match.tx_hash)) tx_hash,match.block_index,match.block_time,source.address source,
  match.lp_asset,match.pair,forward.asset forward_asset,match.forward_quantity,
  backward.asset backward_asset,match.backward_quantity,match.fee_quantity,match.fee_bps
FROM page JOIN pool_matches match ON match.event_index=page.event_index
LEFT JOIN address_dictionary source ON source.address_id=match.source_id
LEFT JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
LEFT JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
ORDER BY match.block_index DESC,match.event_index DESC`;

const CANCEL_FEED_SQL = `WITH page AS (
  SELECT tx_index FROM cancels ORDER BY block_index DESC,tx_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(cancel.tx_hash)) tx_hash,cancel.block_index,cancel.block_time,source.address source,
  LOWER(HEX(parent.tx_hash)) offer_hash,cancel.status
FROM page JOIN cancels cancel ON cancel.tx_index=page.tx_index
LEFT JOIN address_dictionary source ON source.address_id=cancel.source_id
LEFT JOIN transactions parent ON parent.tx_index=cancel.offer_tx_index
ORDER BY cancel.block_index DESC,cancel.tx_index DESC`;

const POOL_LIQUIDITY_FEED_SQL = `WITH page AS (
  SELECT event_index FROM pool_liquidity WHERE kind=?
  ORDER BY block_index DESC,event_index DESC LIMIT ? OFFSET ?
)
SELECT LOWER(HEX(liquidity.tx_hash)) tx_hash,liquidity.block_index,liquidity.block_time,
  source.address source,liquidity.kind,asset_a.asset asset_a,asset_b.asset asset_b,
  liquidity.quantity_a,liquidity.quantity_b,liquidity.quantity_minted,
  liquidity.quantity_destroyed,liquidity.status
FROM page JOIN pool_liquidity liquidity ON liquidity.event_index=page.event_index
LEFT JOIN address_dictionary source ON source.address_id=liquidity.source_id
LEFT JOIN asset_dictionary asset_a ON asset_a.asset_id=liquidity.asset_a_id
LEFT JOIN asset_dictionary asset_b ON asset_b.asset_id=liquidity.asset_b_id
ORDER BY liquidity.block_index DESC,liquidity.event_index DESC`;

export function listTransactions(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<RecordRowMap["transactions"][]> {
  return q<RecordRowMap["transactions"]>(db, TRANSACTION_FEED_SQL, limit, offset);
}

/** Global send feed from the canonical ledger. Event index makes MPMA rows deterministic. */
export function listSends(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["sends"][]> {
  return q<RecordRowMap["sends"]>(db, SEND_FEED_SQL, limit, offset);
}

export function listIssuances(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["issuances"][]> {
  return q<RecordRowMap["issuances"]>(db, ISSUANCE_FEED_SQL, limit, offset);
}

export function listDispensers(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["dispensers"][]> {
  return q<RecordRowMap["dispensers"]>(db, DISPENSER_FEED_SQL, limit, offset);
}

export function listDispenses(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["dispenses"][]> {
  return q<RecordRowMap["dispenses"]>(db, DISPENSE_FEED_SQL, limit, offset);
}

export function listSweeps(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["sweeps"][]> {
  return q<RecordRowMap["sweeps"]>(db, SWEEP_FEED_SQL, limit, offset);
}

export function listDestructions(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<RecordRowMap["destructions"][]> {
  return q<RecordRowMap["destructions"]>(db, DESTRUCTION_FEED_SQL, limit, offset);
}

export function listBurns(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["burns"][]> {
  return q<RecordRowMap["burns"]>(db, BURN_FEED_SQL, limit, offset);
}

export function listDividends(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["dividends"][]> {
  return q<RecordRowMap["dividends"]>(db, DIVIDEND_FEED_SQL, limit, offset);
}

export function listBroadcasts(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["broadcasts"][]> {
  return q<RecordRowMap["broadcasts"]>(db, BROADCAST_FEED_SQL, limit, offset);
}

export function listFairminters(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["fairminters"][]> {
  return q<RecordRowMap["fairminters"]>(db, FAIRMINTER_FEED_SQL, limit, offset);
}

export function listFairmints(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["fairmints"][]> {
  return q<RecordRowMap["fairmints"]>(db, FAIRMINT_FEED_SQL, limit, offset);
}

export function listBtcpays(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["btcpays"][]> {
  return q<RecordRowMap["btcpays"]>(db, BTCPAY_FEED_SQL, limit, offset);
}

export function listBets(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["bets"][]> {
  return q<RecordRowMap["bets"]>(db, BET_FEED_SQL, limit, offset);
}

export function listBetMatches(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["bet_matches"][]> {
  return q<RecordRowMap["bet_matches"]>(db, BET_MATCH_FEED_SQL, limit, offset);
}

export function listRps(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["rps"][]> {
  return q<RecordRowMap["rps"]>(db, RPS_FEED_SQL, limit, offset);
}

export function listRpsMatches(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["rps_matches"][]> {
  return q<RecordRowMap["rps_matches"]>(db, RPS_MATCH_FEED_SQL, limit, offset);
}

export function listPools(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["pools"][]> {
  return q<RecordRowMap["pools"]>(db, POOL_FEED_SQL, limit, offset);
}

export function listPoolMatches(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<RecordRowMap["pool_matches"][]> {
  return q<RecordRowMap["pool_matches"]>(db, POOL_MATCH_FEED_SQL, limit, offset);
}

export function listCancels(db: D1Database, limit: number, offset: number): Promise<RecordRowMap["cancels"][]> {
  return q<RecordRowMap["cancels"]>(db, CANCEL_FEED_SQL, limit, offset);
}

export function listPoolLiquidity(
  db: D1Database,
  kind: "deposit" | "withdrawal",
  limit: number,
  offset: number,
): Promise<RecordRowMap["pool_deposits"][]> {
  return q<RecordRowMap["pool_deposits"]>(db, POOL_LIQUIDITY_FEED_SQL, kind, limit, offset);
}

// orders with normalized give/get quantities (divisibility via join; XCP/BTC are always divisible even
// though they have no assets row). Powers the base/quote price math on the client. Aliases the orders
// table `o`, so its feed orders on o.block_index. Also reused by the per-asset orders tab (queries/assets).
export const ORDER_SELECT = `SELECT o.tx_hash,o.block_index,o.block_time,o.source,o.give_asset,o.get_asset,o.status,o.expiration,o.expire_index,
  CAST(o.give_quantity AS REAL)/(CASE WHEN o.give_asset IN ('XCP','BTC') OR ga.divisible THEN 100000000.0 ELSE 1 END) give_quantity_normalized,
  CAST(o.get_quantity AS REAL)/(CASE WHEN o.get_asset IN ('XCP','BTC') OR gb.divisible THEN 100000000.0 ELSE 1 END) get_quantity_normalized,
  CAST(o.give_remaining AS REAL)/(CASE WHEN o.give_asset IN ('XCP','BTC') OR ga.divisible THEN 100000000.0 ELSE 1 END) give_remaining_normalized,
  CAST(o.get_remaining AS REAL)/(CASE WHEN o.get_asset IN ('XCP','BTC') OR gb.divisible THEN 100000000.0 ELSE 1 END) get_remaining_normalized
  FROM orders o LEFT JOIN assets ga ON ga.asset=o.give_asset LEFT JOIN assets gb ON gb.asset=o.get_asset`;

// order matches with divisibility-normalized forward/backward quantities (same recipe as ORDER_SELECT) so
// a match renders as a trade: pair, side, price, quantity, total.
export const ORDER_MATCH_SELECT = `SELECT om.id,om.block_index,om.block_time,om.tx0_hash,om.tx1_hash,om.tx0_address,om.tx1_address,
  om.forward_asset,om.forward_quantity,om.backward_asset,om.backward_quantity,om.status,
  CAST(om.forward_quantity AS REAL)/(CASE WHEN om.forward_asset IN ('XCP','BTC') OR fa.divisible THEN 100000000.0 ELSE 1 END) forward_quantity_normalized,
  CAST(om.backward_quantity AS REAL)/(CASE WHEN om.backward_asset IN ('XCP','BTC') OR ba.divisible THEN 100000000.0 ELSE 1 END) backward_quantity_normalized
  FROM order_matches om LEFT JOIN assets fa ON fa.asset=om.forward_asset LEFT JOIN assets ba ON ba.asset=om.backward_asset`;

// dispenses with the BTC actually paid + the trades ledger's USD valuation (venue='dispense', ref=id —
// the trades PK, so the join is an index hit per row).
export const DISPENSE_SELECT = `SELECT d.tx_hash,d.block_index,d.block_time,d.source,d.destination,d.asset,
  d.dispense_quantity_normalized,d.dispenser_tx_hash,d.btc_amount,t.usd_value
  FROM dispenses d LEFT JOIN trades t ON t.venue='dispense' AND t.ref=CAST(d.id AS TEXT)`;

// fairmints with the minted asset's divisibility so earn_quantity can render in human units.
export const FAIRMINT_SELECT = `SELECT f.tx_hash,f.block_index,f.block_time,f.source,f.fairminter_tx_hash,f.asset,
  f.earn_quantity,f.paid_quantity,COALESCE(a.divisible,0) divisible,f.status
  FROM fairmints f LEFT JOIN assets a ON a.asset=f.asset`;

/** One record feed: its SELECT column list, plus the ORDER BY column when an aliased join needs qualifying. */
interface RecordFeed {
  select: string;
  orderCol?: string; // defaults to the bare block_index index
}

/** Every record feed's SELECT, keyed by kind (the Record<RecordKind,…> keeps this exhaustive). */
const FEEDS: Record<RecordKind, RecordFeed> = {
  transactions: {
    select: `SELECT tx_hash,tx_index,block_index,block_time,source,destination,btc_amount,fee,supported FROM transactions`,
  },
  sends: {
    select: `SELECT tx_hash,block_index,block_time,source,destination,asset,quantity_normalized,send_type,status,memo FROM sends`,
  },
  issuances: {
    select: `SELECT tx_hash,block_index,block_time,asset,asset_longname,source,issuer,quantity_normalized,transfer,divisible,locked,description,asset_events,status FROM issuances`,
  },
  dispensers: {
    select: `SELECT tx_hash,block_index,block_time,source,asset,give_quantity_normalized,give_remaining_normalized,satoshirate,satoshirate_normalized,dispense_count,status,escrow_quantity,closed_block_index FROM dispensers`,
  },
  dispenses: { select: DISPENSE_SELECT, orderCol: "d.block_index" },
  orders: { select: ORDER_SELECT, orderCol: "o.block_index" },
  order_matches: { select: ORDER_MATCH_SELECT, orderCol: "om.block_index" },
  sweeps: { select: `SELECT tx_hash,block_index,block_time,source,destination,flags,memo,fee_paid,status FROM sweeps` },
  fairminters: {
    select: `SELECT tx_hash,block_index,block_time,source,asset,asset_longname,price,quantity_by_price,hard_cap,soft_cap,pool_quantity,lp_asset,divisible,earned_quantity,paid_quantity,status FROM fairminters`,
  },
  fairmints: { select: FAIRMINT_SELECT, orderCol: "f.block_index" },
  destructions: {
    select: `SELECT tx_hash,block_index,block_time,source,asset,quantity_normalized,tag,status FROM destructions`,
  },
  burns: {
    select: `SELECT tx_hash,block_index,block_time,source,burned_normalized,earned_normalized,status FROM burns`,
  },
  dividends: {
    select: `SELECT tx_hash,block_index,block_time,source,asset,dividend_asset,quantity_per_unit_normalized,status FROM dividends`,
  },
  broadcasts: {
    select: `SELECT tx_hash,block_index,block_time,source,timestamp,value,text,locked,mime_type,status FROM broadcasts`,
  },
  btcpays: {
    select: `SELECT tx_hash,block_index,block_time,source,destination,order_match_id,btc_amount_normalized,status FROM btcpays`,
  },
  bets: {
    select: `SELECT tx_hash,block_index,block_time,source,feed_address,bet_type,deadline,wager_quantity,counterwager_quantity,target_value,leverage,status FROM bets`,
  },
  bet_matches: {
    select: `SELECT id,block_index,block_time,tx0_address,tx1_address,feed_address,forward_quantity,backward_quantity,status FROM bet_matches`,
  },
  rps: { select: `SELECT tx_hash,block_index,block_time,source,possible_moves,wager,expiration,status FROM rps` },
  rps_matches: {
    select: `SELECT id,block_index,block_time,tx0_address,tx1_address,possible_moves,wager,status FROM rps_matches`,
  },
  pools: {
    select: `SELECT lp_asset,pair,asset_a,asset_b,reserve_a,reserve_b,lp_supply,price,status,block_index FROM pools`,
  },
  pool_matches: {
    select: `SELECT tx_hash,block_index,block_time,source,lp_asset,pair,forward_asset,forward_quantity,backward_asset,backward_quantity,fee_quantity,fee_bps FROM pool_matches`,
  },
  cancels: {
    select: `SELECT tx_hash,block_index,block_time,source,offer_hash,status FROM cancels`,
  },
  pool_deposits: {
    select: `SELECT tx_hash,block_index,block_time,source,kind,asset_a,asset_b,quantity_a,quantity_b,quantity_minted,quantity_destroyed,status FROM pool_liquidity WHERE kind='deposit'`,
  },
  pool_withdrawals: {
    select: `SELECT tx_hash,block_index,block_time,source,kind,asset_a,asset_b,quantity_a,quantity_b,quantity_minted,quantity_destroyed,status FROM pool_liquidity WHERE kind='withdrawal'`,
  },
};

/**
 * Run one record feed by kind: append the shared recent-first / pagination tail to its SELECT. The row
 * type is the kind's wire row (RecordRowMap[K]); the orders feed orders on its aliased o.block_index.
 */
export function listRecords<K extends RecordKind>(
  db: D1Database,
  kind: K,
  limit: number,
  offset: number,
): Promise<RecordRowMap[K][]> {
  const feed = FEEDS[kind];
  return q<RecordRowMap[K]>(
    db,
    `${feed.select} ORDER BY ${feed.orderCol ?? "block_index"} DESC LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
}

/* ---------- one transaction's record(s) — the tx page's classification + detail ---------- */

/** Everything a single tx can BE: the feed kinds keyed by their own tx_hash, plus three real message
 *  types that have mirror tables but no index feed (cancels / dispenser refills / pool liquidity).
 *  Match/derived tables (order_matches, bet_matches, pools…) are not probed — a match is not a
 *  transaction, and the pools mirror is keyed by lp_asset (an OPEN_POOL tx is a known classification gap). */
export type TxRecordKind =
  | Extract<
      RecordKind,
      | "sends"
      | "dispenses"
      | "dispensers"
      | "orders"
      | "issuances"
      | "fairminters"
      | "fairmints"
      | "sweeps"
      | "broadcasts"
      | "dividends"
      | "btcpays"
      | "burns"
      | "destructions"
      | "bets"
      | "rps"
      | "pool_matches"
    >
  | "cancels"
  | "dispenser_refills"
  | "pool_liquidity";

// Classification-priority order: SPECIFIC before GENERIC, because one tx legitimately writes several
// rows — a NEW_FAIRMINTER / NEW_FAIRMINT / pool deposit also emits an issuances row (the asset/LP-token
// creation), and a pool swap also writes an orders row (the routing mechanism). The meaning the reader
// wants is the specific act, so issuances and orders rank last among their collisions. Several tables
// (dispenses, fairmints, destructions, btcpays, pool_liquidity) have no tx_hash index, so every probe is
// ALSO scoped to the tx's known block_index and rides that index instead.
const TX_KIND_ORDER: TxRecordKind[] = [
  "dispenses",
  "sends",
  "dispensers",
  "dispenser_refills",
  "cancels",
  "btcpays",
  "fairminters",
  "fairmints",
  "pool_liquidity",
  "pool_matches",
  "orders",
  "issuances",
  "sweeps",
  "broadcasts",
  "dividends",
  "burns",
  "destructions",
  "bets",
  "rps",
];

/** Classify a transaction through its canonical integer identity. Every message table stores
 * tx_index, including multi-row sends/dispenses, so this avoids decoding and probing hash text. */
export async function classifyCoreTx(db: D1Database, txIndex: number): Promise<TxRecordKind | null> {
  const results = await db.batch<{ k: TxRecordKind }>(
    TX_KIND_ORDER.map((kind) => db.prepare(`SELECT '${kind}' k FROM ${kind} WHERE tx_index=?1 LIMIT 1`).bind(txIndex)),
  );
  const found = new Set(results.flatMap((result) => (result.results ?? []).map((row) => row.k)));
  return TX_KIND_ORDER.find((kind) => found.has(kind)) ?? null;
}

type StatelessTxKind = "sends" | "sweeps" | "broadcasts" | "dividends" | "burns" | "destructions" | "bets" | "rps";

const STATELESS_TX_SELECT: Record<StatelessTxKind, string> = {
  sends: `SELECT LOWER(HEX(send.tx_hash)) tx_hash,send.block_index,send.block_time,source.address source,
    destination.address destination,asset.asset,send.quantity_normalized,send.send_type,send.status,send.memo
    FROM sends send
    LEFT JOIN address_dictionary source ON source.address_id=send.source_id
    LEFT JOIN address_dictionary destination ON destination.address_id=send.destination_id
    LEFT JOIN asset_dictionary asset ON asset.asset_id=send.asset_id
    WHERE send.tx_index=?1 ORDER BY send.event_index`,
  sweeps: `SELECT LOWER(HEX(sweep.tx_hash)) tx_hash,sweep.block_index,sweep.block_time,source.address source,
    destination.address destination,sweep.flags,sweep.memo,sweep.fee_paid,sweep.status
    FROM sweeps sweep
    LEFT JOIN address_dictionary source ON source.address_id=sweep.source_id
    LEFT JOIN address_dictionary destination ON destination.address_id=sweep.destination_id
    WHERE sweep.tx_index=?1`,
  broadcasts: `SELECT LOWER(HEX(broadcast.tx_hash)) tx_hash,broadcast.block_index,broadcast.block_time,
    source.address source,broadcast.timestamp,broadcast.value,broadcast.text,broadcast.locked,
    broadcast.mime_type,broadcast.status
    FROM broadcasts broadcast
    LEFT JOIN address_dictionary source ON source.address_id=broadcast.source_id
    WHERE broadcast.tx_index=?1`,
  dividends: `SELECT LOWER(HEX(dividend.tx_hash)) tx_hash,dividend.block_index,dividend.block_time,
    source.address source,asset.asset,dividend_asset.asset dividend_asset,
    dividend.quantity_per_unit_normalized,dividend.status
    FROM dividends dividend
    LEFT JOIN address_dictionary source ON source.address_id=dividend.source_id
    LEFT JOIN asset_dictionary asset ON asset.asset_id=dividend.asset_id
    LEFT JOIN asset_dictionary dividend_asset ON dividend_asset.asset_id=dividend.dividend_asset_id
    WHERE dividend.tx_index=?1`,
  burns: `SELECT LOWER(HEX(burn.tx_hash)) tx_hash,burn.block_index,burn.block_time,source.address source,
    burn.burned_normalized,burn.earned_normalized,burn.status
    FROM burns burn LEFT JOIN address_dictionary source ON source.address_id=burn.source_id
    WHERE burn.tx_index=?1`,
  destructions: `SELECT LOWER(HEX(destruction.tx_hash)) tx_hash,destruction.block_index,destruction.block_time,
    source.address source,asset.asset,destruction.quantity_normalized,destruction.tag,destruction.status
    FROM destructions destruction
    LEFT JOIN address_dictionary source ON source.address_id=destruction.source_id
    LEFT JOIN asset_dictionary asset ON asset.asset_id=destruction.asset_id
    WHERE destruction.tx_index=?1 ORDER BY destruction.event_index`,
  bets: `SELECT LOWER(HEX(bet.tx_hash)) tx_hash,bet.block_index,bet.block_time,source.address source,
    feed.address feed_address,bet.bet_type,bet.deadline,bet.wager_quantity,bet.counterwager_quantity,
    bet.target_value,bet.leverage,bet.status
    FROM bets bet
    LEFT JOIN address_dictionary source ON source.address_id=bet.source_id
    LEFT JOIN address_dictionary feed ON feed.address_id=bet.feed_address_id
    WHERE bet.tx_index=?1`,
  rps: `SELECT LOWER(HEX(rps.tx_hash)) tx_hash,rps.block_index,rps.block_time,source.address source,
    rps.possible_moves,rps.wager,rps.expiration,rps.status
    FROM rps LEFT JOIN address_dictionary source ON source.address_id=rps.source_id
    WHERE rps.tx_index=?1`,
};

export function coreStatelessRecordsByTx<K extends StatelessTxKind>(
  db: D1Database,
  kind: K,
  txIndex: number,
): Promise<RecordRowMap[K][]> {
  return q<RecordRowMap[K]>(db, STATELESS_TX_SELECT[kind], txIndex);
}

type ContextTxKind = "issuances" | "fairminters" | "fairmints" | "btcpays" | "pool_matches";

const CONTEXT_TX_SELECT: Record<ContextTxKind, string> = {
  issuances: `SELECT LOWER(HEX(issuance.tx_hash)) tx_hash,issuance.block_index,issuance.block_time,
    asset.asset,issuance.asset_longname,source.address source,issuer.address issuer,
    issuance.quantity_normalized,issuance.transfer,issuance.divisible,issuance.locked,
    issuance.description,issuance.asset_events,issuance.status
    FROM issuances issuance
    LEFT JOIN asset_dictionary asset ON asset.asset_id=issuance.asset_id
    LEFT JOIN address_dictionary source ON source.address_id=issuance.source_id
    LEFT JOIN address_dictionary issuer ON issuer.address_id=issuance.issuer_id
    WHERE issuance.tx_index=?1 ORDER BY issuance.msg_index`,
  fairminters: `SELECT LOWER(HEX(fairminter.tx_hash)) tx_hash,fairminter.block_index,fairminter.block_time,
    source.address source,asset.asset,fairminter.asset_longname,fairminter.price,
    fairminter.quantity_by_price,fairminter.hard_cap,fairminter.soft_cap,fairminter.pool_quantity,
    fairminter.lp_asset,fairminter.divisible,fairminter.earned_quantity,fairminter.paid_quantity,
    fairminter.status
    FROM fairminters fairminter
    LEFT JOIN address_dictionary source ON source.address_id=fairminter.source_id
    LEFT JOIN asset_dictionary asset ON asset.asset_id=fairminter.asset_id
    WHERE fairminter.tx_index=?1`,
  fairmints: `SELECT LOWER(HEX(fairmint.tx_hash)) tx_hash,fairmint.block_index,fairmint.block_time,
    source.address source,LOWER(HEX(fairminter.tx_hash)) fairminter_tx_hash,asset.asset,
    fairmint.earn_quantity,fairmint.paid_quantity,COALESCE(asset_state.divisible,0) divisible,fairmint.status
    FROM fairmints fairmint
    LEFT JOIN address_dictionary source ON source.address_id=fairmint.source_id
    LEFT JOIN fairminters fairminter ON fairminter.tx_index=fairmint.fairminter_tx_index
    LEFT JOIN asset_dictionary asset ON asset.asset_id=fairmint.asset_id
    LEFT JOIN assets asset_state ON asset_state.asset_id=fairmint.asset_id
    WHERE fairmint.tx_index=?1`,
  btcpays: `SELECT LOWER(HEX(btcpay.tx_hash)) tx_hash,btcpay.block_index,btcpay.block_time,
    source.address source,destination.address destination,
    LOWER(HEX(match.tx0_hash)||'_'||HEX(match.tx1_hash)) order_match_id,
    btcpay.btc_amount_normalized,btcpay.status
    FROM btcpays btcpay
    LEFT JOIN address_dictionary source ON source.address_id=btcpay.source_id
    LEFT JOIN address_dictionary destination ON destination.address_id=btcpay.destination_id
    LEFT JOIN order_matches match ON match.tx0_index=btcpay.order_match_tx0_index
      AND match.tx1_index=btcpay.order_match_tx1_index
    WHERE btcpay.tx_index=?1`,
  pool_matches: `SELECT LOWER(HEX(match.tx_hash)) tx_hash,match.block_index,match.block_time,
    source.address source,match.lp_asset,match.pair,forward.asset forward_asset,match.forward_quantity,
    backward.asset backward_asset,match.backward_quantity,match.fee_quantity,match.fee_bps
    FROM pool_matches match
    LEFT JOIN address_dictionary source ON source.address_id=match.source_id
    LEFT JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
    LEFT JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
    WHERE match.tx_index=?1`,
};

export function coreContextRecordsByTx<K extends ContextTxKind>(
  db: D1Database,
  kind: K,
  txIndex: number,
): Promise<RecordRowMap[K][]> {
  return q<RecordRowMap[K]>(db, CONTEXT_TX_SELECT[kind], txIndex);
}

export function corePoolLiquidityByTx(db: D1Database, txIndex: number): Promise<PoolLiquidityRow[]> {
  return q<PoolLiquidityRow>(
    db,
    `SELECT LOWER(HEX(liquidity.tx_hash)) tx_hash,liquidity.block_index,liquidity.block_time,
      source.address source,liquidity.kind,asset_a.asset asset_a,asset_b.asset asset_b,
      liquidity.quantity_a,liquidity.quantity_b,liquidity.quantity_minted,liquidity.quantity_destroyed,
      liquidity.status
      FROM pool_liquidity liquidity
      LEFT JOIN address_dictionary source ON source.address_id=liquidity.source_id
      LEFT JOIN asset_dictionary asset_a ON asset_a.asset_id=liquidity.asset_a_id
      LEFT JOIN asset_dictionary asset_b ON asset_b.asset_id=liquidity.asset_b_id
      WHERE liquidity.tx_index=?1`,
    txIndex,
  );
}

export function coreDispensersByTx(db: D1Database, txIndex: number): Promise<RecordRowMap["dispensers"][]> {
  return q<RecordRowMap["dispensers"]>(
    db,
    `SELECT LOWER(HEX(dispenser.tx_hash)) tx_hash,dispenser.block_index,dispenser.block_time,
      source.address source,asset.asset,dispenser.give_quantity_normalized,dispenser.give_remaining_normalized,
      dispenser.satoshirate,dispenser.satoshirate_normalized,dispenser.dispense_count,dispenser.status,
      dispenser.escrow_quantity,dispenser.closed_block_index
      FROM dispensers dispenser
      LEFT JOIN address_dictionary source ON source.address_id=dispenser.source_id
      LEFT JOIN asset_dictionary asset ON asset.asset_id=dispenser.asset_id
      WHERE dispenser.tx_index=?1`,
    txIndex,
  );
}

export function coreDispensesByTx(db: D1Database, txIndex: number): Promise<RecordRowMap["dispenses"][]> {
  return q<RecordRowMap["dispenses"]>(
    db,
    `SELECT LOWER(HEX(dispense.tx_hash)) tx_hash,dispense.block_index,dispense.block_time,
      source.address source,destination.address destination,asset.asset,dispense.dispense_quantity_normalized,
      LOWER(HEX(parent.tx_hash)) dispenser_tx_hash,dispense.btc_amount,trade.usd_value
      FROM dispenses dispense
      LEFT JOIN address_dictionary source ON source.address_id=dispense.source_id
      LEFT JOIN address_dictionary destination ON destination.address_id=dispense.destination_id
      LEFT JOIN asset_dictionary asset ON asset.asset_id=dispense.asset_id
      LEFT JOIN dispensers parent ON parent.tx_index=dispense.dispenser_tx_index
      LEFT JOIN trades trade ON trade.venue='dispense' AND trade.ref=CAST(dispense.dispense_id AS TEXT)
      WHERE dispense.tx_index=?1 ORDER BY dispense.dispense_index`,
    txIndex,
  );
}

export function coreRefillsByTx(db: D1Database, txIndex: number): Promise<DispenserRefillRow[]> {
  return q<DispenserRefillRow>(
    db,
    `SELECT LOWER(HEX(refill.tx_hash)) tx_hash,refill.block_index,refill.block_time,source.address source,
      destination.address destination,asset.asset,refill.dispense_quantity,
      LOWER(HEX(dispenser.tx_hash)) dispenser_tx_hash
      FROM dispenser_refills refill
      LEFT JOIN address_dictionary source ON source.address_id=refill.source_id
      LEFT JOIN address_dictionary destination ON destination.address_id=refill.destination_id
      LEFT JOIN asset_dictionary asset ON asset.asset_id=refill.asset_id
      LEFT JOIN dispensers dispenser ON dispenser.tx_index=refill.dispenser_tx_index
      WHERE refill.tx_index=?1 ORDER BY refill.event_index`,
    txIndex,
  );
}

export function coreCancelsByTx(db: D1Database, txIndex: number): Promise<CancelRow[]> {
  return q<CancelRow>(
    db,
    `SELECT LOWER(HEX(cancel.tx_hash)) tx_hash,cancel.block_index,cancel.block_time,source.address source,
      LOWER(HEX(offer.tx_hash)) offer_hash,cancel.status
      FROM cancels cancel
      LEFT JOIN address_dictionary source ON source.address_id=cancel.source_id
      LEFT JOIN orders offer ON offer.tx_index=cancel.offer_tx_index
      WHERE cancel.tx_index=?1`,
    txIndex,
  );
}

export function coreDispensesOfDispenser(
  db: D1Database,
  dispenserTxIndex: number,
  limit = 8,
): Promise<RecordRowMap["dispenses"][]> {
  return q<RecordRowMap["dispenses"]>(
    db,
    `SELECT LOWER(HEX(dispense.tx_hash)) tx_hash,dispense.block_index,dispense.block_time,
      source.address source,destination.address destination,asset.asset,dispense.dispense_quantity_normalized,
      LOWER(HEX(parent.tx_hash)) dispenser_tx_hash,dispense.btc_amount,trade.usd_value
      FROM dispenses dispense
      LEFT JOIN address_dictionary source ON source.address_id=dispense.source_id
      LEFT JOIN address_dictionary destination ON destination.address_id=dispense.destination_id
      LEFT JOIN asset_dictionary asset ON asset.asset_id=dispense.asset_id
      LEFT JOIN dispensers parent ON parent.tx_index=dispense.dispenser_tx_index
      LEFT JOIN trades trade ON trade.venue='dispense' AND trade.ref=CAST(dispense.dispense_id AS TEXT)
      WHERE dispense.dispenser_tx_index=?1 ORDER BY dispense.block_index DESC,dispense.event_index DESC LIMIT ?2`,
    dispenserTxIndex,
    limit,
  );
}

export function coreDispenserTotals(
  db: D1Database,
  dispenserTxIndex: number,
): Promise<{ n: number; sats: number; units: number } | null> {
  return one<{ n: number; sats: number; units: number }>(
    db,
    `SELECT COUNT(*) n,COALESCE(SUM(CAST(btc_amount AS REAL)),0) sats,
      COALESCE(SUM(CAST(dispense_quantity_normalized AS REAL)),0) units
      FROM dispenses WHERE dispenser_tx_index=?1`,
    dispenserTxIndex,
  );
}

type ParentBearingKind = "dispenses" | "dispenser_refills" | "cancels" | "fairmints";
const PARENT_COLUMN: Record<ParentBearingKind, string> = {
  dispenses: "dispenser_tx_index",
  dispenser_refills: "dispenser_tx_index",
  cancels: "offer_tx_index",
  fairmints: "fairminter_tx_index",
};

export async function coreParentTxIndex(
  db: D1Database,
  kind: ParentBearingKind,
  txIndex: number,
): Promise<number | null> {
  const row = await one<{ parent: number | null }>(
    db,
    `SELECT ${PARENT_COLUMN[kind]} parent FROM ${kind} WHERE tx_index=?1 LIMIT 1`,
    txIndex,
  );
  return row?.parent ?? null;
}
