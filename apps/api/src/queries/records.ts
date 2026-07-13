/**
 * Record feed queries — the 21 generic recent-first index feeds, one per Counterparty RecordKind
 * (GET /v2/<kind>). Each feed is a fixed SELECT column list off its mirror table; every feed shares the
 * same `ORDER BY <col> DESC LIMIT ? OFFSET ?` tail. Rows pass through their SELECTed columns — the wire
 * contract for each feed is @xcp/shared/records, keyed by kind via RecordRowMap. Offset pagination only
 * (a short page ends the feed) so the UI never pays for a COUNT(*) over millions of rows.
 */
import type { RecordKind, RecordRowMap, CancelRow, DispenserRefillRow, PoolLiquidityRow } from "@xcp/shared/records";
import { q, one } from "#api/db";

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
// column-qualifying alias per aliased feed (mirrors the aliases the SELECTs use)
const TX_ALIAS: Partial<Record<TxRecordKind, string>> = { dispenses: "d.", orders: "o.", fairmints: "f." };

// The three non-feed message tables: their tx-page SELECTs live here (records.ts owns record SQL).
const TX_ONLY_SELECTS: Record<"cancels" | "dispenser_refills" | "pool_liquidity", string> = {
  cancels: `SELECT tx_hash,block_index,block_time,source,offer_hash,status FROM cancels`,
  dispenser_refills: `SELECT tx_hash,block_index,block_time,source,destination,asset,dispense_quantity,dispenser_tx_hash FROM dispenser_refills`,
  pool_liquidity: `SELECT tx_hash,block_index,block_time,source,kind,asset_a,asset_b,quantity_a,quantity_b,quantity_minted,quantity_destroyed,status FROM pool_liquidity`,
};

/** Which record kind is this confirmed tx? One D1 batch of block-scoped point probes across every
 *  message table (one network round trip; a compound UNION would trip D1's compound-SELECT term cap). */
export async function classifyTx(db: D1Database, hash: string, blockIndex: number): Promise<TxRecordKind | null> {
  const results = await db.batch<{ k: TxRecordKind }>(
    TX_KIND_ORDER.map((k) =>
      db.prepare(`SELECT '${k}' k FROM ${k} WHERE tx_hash=?1 AND block_index=?2 LIMIT 1`).bind(hash, blockIndex),
    ),
  );
  const found = new Set(results.flatMap((r) => (r.results ?? []).map((row) => row.k)));
  return TX_KIND_ORDER.find((k) => found.has(k)) ?? null;
}

/** A dispenser's sales — recent dispenses of one machine (rides idx_dispe_disp). The tx-page
 *  storefront's history table + social proof. */
export function dispensesOfDispenser(
  db: D1Database,
  dispenserTx: string,
  limit = 8,
): Promise<RecordRowMap["dispenses"][]> {
  return q<RecordRowMap["dispenses"]>(
    db,
    `${DISPENSE_SELECT} WHERE d.dispenser_tx_hash=? ORDER BY d.block_index DESC LIMIT ?`,
    dispenserTx,
    limit,
  );
}

/** A dispenser's lifetime totals — sales count, BTC taken (sats), units vended. One sale can vend
 *  many multiples of give_quantity, so the storefront's stock math needs UNITS, not event counts. */
export function dispenserTotals(
  db: D1Database,
  dispenserTx: string,
): Promise<{ n: number; sats: number; units: number } | null> {
  return one<{ n: number; sats: number; units: number }>(
    db,
    `SELECT COUNT(*) n, COALESCE(SUM(CAST(btc_amount AS REAL)),0) sats,
            COALESCE(SUM(CAST(dispense_quantity_normalized AS REAL)),0) units
       FROM dispenses WHERE dispenser_tx_hash=?`,
    dispenserTx,
  );
}

/** An order's matches — the tape under the offer (the dispenser-sales pattern). A match references
 *  its two maker orders by tx0/tx1; the order can be either side (rides idx_om_tx0/idx_om_tx1). */
export function matchesOfOrder(db: D1Database, orderTx: string, limit = 10): Promise<RecordRowMap["order_matches"][]> {
  return q<RecordRowMap["order_matches"]>(
    db,
    `${ORDER_MATCH_SELECT} WHERE om.tx0_hash=?1 OR om.tx1_hash=?1 ORDER BY om.block_index DESC LIMIT ?2`,
    orderTx,
    limit,
  );
}

/** TxRecordKind → row shape (the feed kinds' wire rows + the three tx-only rows). */
export type TxRecordRowMap = { [K in Extract<TxRecordKind, RecordKind>]: RecordRowMap[K] } & {
  cancels: CancelRow;
  dispenser_refills: DispenserRefillRow;
  pool_liquidity: PoolLiquidityRow;
};

/** The record row(s) behind one tx (MPMA sends return several). Feed kinds reuse the feed's SELECT, so
 *  the row shape is the kind's wire row; the three tx-only kinds use their own SELECTs above. blockIndex
 *  scopes the read onto the block index for the tables without a tx_hash index; omit it for parent-context
 *  lookups keyed by a DIFFERENT tx (a dispense's dispenser, a fairmint's fairminter — tx_hash-PK tables). */
export function recordsByTxHash<K extends TxRecordKind>(
  db: D1Database,
  kind: K,
  hash: string,
  blockIndex?: number,
): Promise<TxRecordRowMap[K][]> {
  const select =
    kind in TX_ONLY_SELECTS ? TX_ONLY_SELECTS[kind as keyof typeof TX_ONLY_SELECTS] : FEEDS[kind as RecordKind].select;
  const a = TX_ALIAS[kind] ?? "";
  const scope = blockIndex != null ? ` AND ${a}block_index=?2` : "";
  const args: (string | number)[] = blockIndex != null ? [hash, blockIndex] : [hash];
  return q<TxRecordRowMap[K]>(db, `${select} WHERE ${a}tx_hash=?1${scope}`, ...args);
}
