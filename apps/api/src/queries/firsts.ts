/**
 * Firsts queries — the earliest record of each kind of on-chain moment. This owns the firsts catalog and
 * the index-fast "earliest matching row" SQL; the handler runs each, formats the date, and sorts.
 *
 * EARLIEST matching row, index-fast. A bare `ORDER BY block_index, <tx_index|event_index> LIMIT 1` can't use a
 * single-column block_index index for the secondary sort, so SQLite full-scans the whole table into a TEMP
 * B-TREE (sends = 1.75M rows read for ONE row — confirmed via EXPLAIN QUERY PLAN). Instead we narrow to
 * MIN(block_index) first — which DOES use the block_index index (and for filtered firsts stops at the first
 * matching block) — then order only the handful of rows inside that single earliest block. Verified to return
 * the identical row while turning the SCAN+TEMP-B-TREE into a SEARCH ... USING INDEX (block_index=?).
 */
import { one } from "../db";

/** One firsts-catalog entry: a display label + the SQL that finds its earliest row. */
export interface First {
  key: string;
  label: string;
  sql: string;
}

/** The raw shape every firsts SQL returns: block index, unix block time, display ref, entity type. */
export interface FirstRaw {
  b: number | null;
  t: number | null;
  ref: string;
  typ: string;
}

// each sql returns: b (block index), t (unix block time), ref (display + link id), typ (entity type for linking)
const earliest = (
  table: string,
  ref: string,
  opts: { where?: string; by?: string; bcol?: string } = {}
): string => {
  const { where, by = "rowid", bcol = "block_index" } = opts;
  const tcol = bcol === "block_index" ? "block_time" : "first_issuance_block_time";
  const filt = where ? ` AND (${where})` : "";
  const minWhere = where ? ` WHERE ${where}` : "";
  return `SELECT ${bcol} b, ${tcol} t, ${ref} FROM ${table} WHERE ${bcol}=(SELECT MIN(${bcol}) FROM ${table}${minWhere})${filt} ORDER BY ${by} LIMIT 1`;
};
// asset-property firsts read the ISSUANCES event (first valid issuance that set the property), not assets state.
const viss = (extra: string) => earliest("issuances", "asset ref, 'asset' typ", { where: `status='valid' AND (${extra})`, by: "tx_index" });

export const FIRSTS: First[] = [
  // --- protocol genesis ---
  { key: "block",        label: "First block",            sql: earliest("blocks", "CAST(block_index AS TEXT) ref, 'block' typ", { by: "block_index" }) },
  { key: "transaction",  label: "First transaction",      sql: earliest("transactions", "tx_hash ref, 'tx' typ", { by: "tx_index" }) },
  { key: "burn",         label: "First XCP burn",         sql: earliest("burns", "source ref, 'address' typ") },
  // --- assets ---
  { key: "asset",        label: "First asset issued",     sql: earliest("issuances", "asset ref, 'asset' typ", { by: "tx_index" }) },
  { key: "subasset",     label: "First subasset",         sql: earliest("assets", "asset ref, 'asset' typ", { where: "type='subasset'", bcol: "first_issuance_block_index" }) },
  { key: "numeric",      label: "First numeric asset",    sql: earliest("assets", "asset ref, 'asset' typ", { where: "type='numeric'", bcol: "first_issuance_block_index" }) },
  { key: "destruction",  label: "First destruction",      sql: earliest("destructions", "asset ref, 'asset' typ", { by: "event_index" }) },
  // --- transfers & markets ---
  { key: "send",         label: "First send",             sql: earliest("sends", "asset ref, 'asset' typ", { by: "tx_index" }) },
  { key: "order",        label: "First DEX order",        sql: earliest("orders", "tx_hash ref, 'tx' typ") },
  { key: "order_match",  label: "First order match",      sql: earliest("order_matches", "tx0_hash ref, 'tx' typ") },
  { key: "dispenser",    label: "First dispenser",        sql: earliest("dispensers", "asset ref, 'asset' typ") },
  { key: "dispense",     label: "First dispense",         sql: earliest("dispenses", "asset ref, 'asset' typ", { by: "event_index" }) },
  // --- other message types ---
  { key: "dividend",     label: "First dividend",         sql: earliest("dividends", "asset ref, 'asset' typ") },
  { key: "broadcast",    label: "First broadcast",        sql: earliest("broadcasts", "source ref, 'address' typ") },
  { key: "bet",          label: "First bet",              sql: earliest("bets", "source ref, 'address' typ") },
  { key: "sweep",        label: "First sweep",            sql: earliest("sweeps", "source ref, 'address' typ") },
  { key: "cancel",       label: "First cancel",           sql: earliest("cancels", "tx_hash ref, 'tx' typ") },
  { key: "btcpay",       label: "First BTC pay",          sql: earliest("btcpays", "tx_hash ref, 'tx' typ") },
  { key: "non_xcp_order",label: "First non-XCP DEX order",sql: earliest("orders", "tx_hash ref, 'tx' typ", { where: "give_asset!='XCP' AND get_asset!='XCP'" }) },
  { key: "btc_dispense", label: "First dispense paid in BTC", sql: earliest("dispenses", "asset ref, 'asset' typ", { where: "btc_amount>0", by: "event_index" }) },
  // asset-PROPERTY firsts — from the ISSUANCES table (the EVENT that first set the property), NOT the assets
  // current-state table. e.g. first LOCKED = first valid issuance with locked=1, not the oldest now-locked asset.
  { key: "locked",       label: "First locked issuance",  sql: viss(`locked=1`) },
  { key: "divisible",    label: "First divisible asset",  sql: viss(`divisible=1`) },
  { key: "indivisible",  label: "First indivisible asset",sql: viss(`divisible=0`) },
  { key: "one_of_one",   label: "First 1/1 (single edition)", sql: viss(`divisible=0 AND locked=1 AND CAST(quantity AS INTEGER)=1`) },
  { key: "reset",        label: "First asset reset (CIP03)", sql: viss(`reset=1`) },
  { key: "transfer",     label: "First asset transfer",   sql: viss(`transfer=1`) },
  { key: "callable",     label: "First callable asset",   sql: viss(`callable=1`) },
  { key: "description",  label: "First asset description",sql: viss(`description IS NOT NULL AND description!=''`) },
  { key: "json_desc",    label: "First JSON description", sql: viss(`TRIM(description) LIKE '{%'`) },
  { key: "mime",         label: "First MIME-typed asset", sql: viss(`mime_type IS NOT NULL AND mime_type!=''`) },
  { key: "easyasset",    label: "First EasyAsset",        sql: viss(`lower(description) LIKE '%easyasset%'`) },
  { key: "fairminter",   label: "First fairminter",       sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM fairminters ORDER BY block_index, rowid LIMIT 1` },
  { key: "fairmint",     label: "First fairmint",         sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM fairmints ORDER BY block_index, rowid LIMIT 1` },
  // --- derived firsts (our classification layer) ---
  // CURATED: the canonical first Bitcoin Stamp (Stamp #0) is protocol-defined — it must be a NUMERIC asset AND
  // pass keyburn validation, which we can't derive from Counterparty alone (multiple stamp: assets share the
  // genesis block 779652). The community/protocol Stamp #0 is A7337447728884561000; we display its real block/date.
  { key: "stamp",        label: "First Bitcoin Stamp",    sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM issuances WHERE asset='A7337447728884561000' ORDER BY block_index LIMIT 1` },
  { key: "src20",        label: "First SRC-20 token",     sql: `SELECT i.block_index b, i.block_time t, i.asset ref, 'asset' typ FROM issuances i JOIN tags tg ON tg.entity_type='asset' AND tg.entity_id=i.asset AND tg.tag='src20' WHERE instr(lower(i.description),'stamp:')>0 ORDER BY i.block_index LIMIT 1` },
  { key: "src721",       label: "First SRC-721 token",    sql: `SELECT i.block_index b, i.block_time t, i.asset ref, 'asset' typ FROM issuances i JOIN tags tg ON tg.entity_type='asset' AND tg.entity_id=i.asset AND tg.tag='src721' WHERE instr(lower(i.description),'stamp:')>0 ORDER BY i.block_index LIMIT 1` },
  { key: "btns",         label: "First BTNS broadcast",   sql: `SELECT block_index b, block_time t, source ref, 'address' typ FROM broadcasts WHERE btns=1 ORDER BY block_index, rowid LIMIT 1` },
];

/** Run one firsts SQL; null on any error (a table may be empty on a fresh mirror). */
export function firstRecord(db: D1Database, sql: string): Promise<FirstRaw | null> {
  return one<FirstRaw>(db, sql).catch(() => null);
}
