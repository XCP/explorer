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
import { one } from "#api/db";

/** One firsts-catalog entry: a display label + the SQL that finds its earliest row. */
export interface FirstDefinition {
  key: string;
  label: string;
  sql: string;
}

/** The raw shape every firsts SQL returns: block index, unix block time, display ref, entity type. */
export interface FirstQueryRow {
  b: number | null;
  t: number | null;
  ref: string;
  typ: string;
  tx: string;
}

// Every query returns the same aliases: b, t, ref, typ, and tx. See docs/adding-firsts.md.
const earliestEventSql = (
  table: string,
  ref: string,
  opts: { where?: string; by?: string; bcol?: string; joins?: string; valid?: boolean; tx?: string } = {},
): string => {
  const { where, by = "x.rowid", bcol = "block_index", joins = "", valid = false,
    tx = "LOWER(HEX(x.tx_hash))" } = opts;
  const tcol = bcol === "block_index" ? "block_time" : "first_issuance_block_time";
  const predicate = [valid ? "status NOT LIKE 'invalid%'" : "", where ? `(${where})` : ""]
    .filter(Boolean).join(" AND ");
  const filt = predicate ? ` AND (${predicate})` : "";
  const minWhere = predicate ? ` WHERE ${predicate}` : "";
  return `SELECT x.${bcol} b,x.${tcol} t,${ref},${tx} tx FROM ${table} x ${joins}
    WHERE x.${bcol}=(SELECT MIN(${bcol}) FROM ${table}${minWhere})${filt} ORDER BY ${by} LIMIT 1`;
};
// asset-property firsts read the ISSUANCES event (first valid issuance that set the property), not assets state.
const earliestValidIssuanceSql = (extra: string) =>
  earliestEventSql("issuances", "asset.asset ref,'asset' typ", {
    where: extra,
    valid: true,
    by: "x.tx_index,x.event_index",
    joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
  });

// Supply-sensitive milestones must reconstruct net supply at the locking event. Looking only at the
// lock row's quantity misses assets issued across several transactions; looking at today's asset state
// lets later issuance/destruction rewrite history.
const earliestLockedSupplySql = (supply: number, extra: string) => `SELECT x.block_index b,x.block_time t,
  asset.asset ref,'asset' typ,LOWER(HEX(x.tx_hash)) tx
  FROM issuances x JOIN asset_dictionary asset ON asset.asset_id=x.asset_id
  WHERE x.status NOT LIKE 'invalid%' AND x.locked=1 AND (${extra})
    AND COALESCE((SELECT SUM(CAST(i.quantity AS INTEGER)) FROM issuances i
      WHERE i.asset_id=x.asset_id AND i.status NOT LIKE 'invalid%' AND i.event_index<=x.event_index),0)
      - COALESCE((SELECT SUM(CAST(d.quantity AS INTEGER)) FROM destructions d
      WHERE d.asset_id=x.asset_id AND d.status NOT LIKE 'invalid%' AND d.event_index<=x.event_index),0)=${supply}
  ORDER BY x.block_index,x.tx_index,x.event_index LIMIT 1`;

export const FIRSTS_CATALOG: FirstDefinition[] = [
  // --- protocol genesis ---
  {
    key: "block",
    label: "First block",
    sql: earliestEventSql("transactions", "CAST(x.block_index AS TEXT) ref,'block' typ", { by: "x.tx_index" }),
  },
  {
    key: "transaction",
    label: "First transaction",
    sql: earliestEventSql("transactions", "LOWER(HEX(x.tx_hash)) ref,'tx' typ", { by: "x.tx_index" }),
  },
  {
    key: "burn",
    label: "First XCP burn",
    sql: earliestEventSql("burns", "source.address ref,'address' typ", {
      valid: true,
      by: "x.tx_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  // --- assets ---
  {
    key: "asset",
    label: "First asset issued",
    sql: earliestEventSql("issuances", "asset.asset ref,'asset' typ", {
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "subasset",
    label: "First subasset",
    sql: earliestValidIssuanceSql("asset_longname IS NOT NULL"),
  },
  {
    key: "numeric",
    label: "First numeric asset",
    sql: earliestValidIssuanceSql("asset.asset GLOB 'A[0-9]*'"),
  },
  {
    key: "destruction",
    label: "First destruction",
    sql: earliestEventSql("destructions", "asset.asset ref,'asset' typ", {
      valid: true,
      by: "x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  // --- transfers & markets ---
  {
    key: "send",
    label: "First send",
    sql: earliestEventSql("sends", "asset.asset ref,'asset' typ", {
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "order",
    label: "First DEX order",
    sql: earliestEventSql("orders", "give_asset.asset ref,'asset' typ", {
      by: "x.tx_index", valid: true,
      joins: "JOIN asset_dictionary give_asset ON give_asset.asset_id=x.give_asset_id",
    }),
  },
  {
    key: "order_match",
    label: "First order match",
    sql: earliestEventSql("order_matches", "forward_asset.asset||' / '||backward_asset.asset ref,'pair' typ", {
      by: "x.tx0_index,x.tx1_index", valid: true, tx: "LOWER(HEX(x.tx1_hash))",
      joins: "JOIN asset_dictionary forward_asset ON forward_asset.asset_id=x.forward_asset_id JOIN asset_dictionary backward_asset ON backward_asset.asset_id=x.backward_asset_id",
    }),
  },
  {
    key: "dispenser",
    label: "First dispenser",
    sql: earliestEventSql("dispensers", "asset.asset ref,'asset' typ", {
      valid: true,
      by: "x.tx_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "oracle_dispenser",
    label: "First oracle-priced dispenser",
    sql: earliestEventSql("dispensers", "asset.asset ref,'asset' typ", {
      where: "oracle_address_id IS NOT NULL",
      by: "x.tx_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "dispense",
    label: "First dispense",
    sql: earliestEventSql("dispenses", "asset.asset ref,'asset' typ", {
      by: "x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  // --- other message types ---
  {
    key: "dividend",
    label: "First dividend",
    sql: earliestEventSql("dividends", "asset.asset ref,'asset' typ", {
      valid: true,
      by: "x.tx_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "broadcast",
    label: "First broadcast",
    sql: earliestEventSql("broadcasts", "source.address ref,'address' typ", {
      valid: true,
      by: "x.tx_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "priced_oracle",
    label: "First priced oracle broadcast",
    sql: earliestEventSql("broadcasts", "source.address ref,'address' typ", {
      where: "CAST(fee_fraction_int AS INTEGER)>0",
      valid: true,
      by: "x.tx_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "bet",
    label: "First bet",
    sql: earliestEventSql("bets", "source.address ref,'address' typ", {
      valid: true,
      by: "x.tx_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "bet_match",
    label: "First bet match",
    sql: earliestEventSql("bet_matches", "feed.address ref,'address' typ", {
      by: "x.tx0_index,x.tx1_index", valid: true, tx: "LOWER(HEX(x.tx1_hash))",
      joins: "JOIN address_dictionary feed ON feed.address_id=x.feed_address_id",
    }),
  },
  {
    key: "rps",
    label: "First RPS game",
    sql: earliestEventSql("rps", "source.address ref,'address' typ", {
      by: "x.tx_index", valid: true,
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "rps_match",
    label: "First RPS match",
    sql: earliestEventSql("rps_matches", "player.address ref,'address' typ", {
      by: "x.tx0_index,x.tx1_index", valid: true, tx: "LOWER(HEX(x.tx1_hash))",
      joins: "JOIN address_dictionary player ON player.address_id=x.tx1_address_id",
    }),
  },
  {
    key: "sweep",
    label: "First sweep",
    sql: earliestEventSql("sweeps", "source.address ref,'address' typ", {
      valid: true,
      by: "x.tx_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "sweep_memo",
    label: "First sweep with a memo",
    sql: earliestEventSql("sweeps", "source.address ref,'address' typ", {
      where: "memo IS NOT NULL AND memo!=''",
      valid: true,
      by: "x.tx_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "cancel",
    label: "First cancel",
    sql: earliestEventSql("cancels", "source.address ref,'address' typ", {
      by: "x.tx_index", valid: true,
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "btcpay",
    label: "First BTC pay",
    sql: earliestEventSql("btcpays", "source.address ref,'address' typ", {
      by: "x.event_index", valid: true,
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "non_xcp_order",
    label: "First non-XCP DEX order",
    sql: earliestEventSql("orders", "give_asset.asset||' / '||get_asset.asset ref,'pair' typ", {
      where:
        "give_asset_id!=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP') AND get_asset_id!=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')",
      valid: true,
      by: "x.tx_index",
      joins: "JOIN asset_dictionary give_asset ON give_asset.asset_id=x.give_asset_id JOIN asset_dictionary get_asset ON get_asset.asset_id=x.get_asset_id",
    }),
  },
  {
    key: "btc_dispense",
    label: "First dispense paid in BTC",
    sql: earliestEventSql("dispenses", "asset.asset ref,'asset' typ", {
      where: "CAST(btc_amount AS INTEGER)>0",
      by: "x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "enhanced_send",
    label: "First enhanced send",
    sql: earliestEventSql("sends", "asset.asset ref,'asset' typ", {
      where: "send_type='enhanced_send'",
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "send_memo",
    label: "First send with a memo",
    sql: earliestEventSql("sends", "asset.asset ref,'asset' typ", {
      where: "memo IS NOT NULL AND memo!=''",
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "dispenser_refill",
    label: "First dispenser refill",
    sql: earliestEventSql("dispenser_refills", "asset.asset ref,'asset' typ", {
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "mpma",
    label: "First MPMA send",
    sql: earliestEventSql("sends", "source.address ref,'address' typ", {
      where: "send_type='mpma'",
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
  {
    key: "attach",
    label: "First UTXO attach",
    sql: earliestEventSql("sends", "asset.asset ref,'asset' typ", {
      where: "send_type='attach'",
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "move",
    label: "First UTXO move",
    sql: earliestEventSql("sends", "asset.asset ref,'asset' typ", {
      where: "send_type='move'",
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "detach",
    label: "First UTXO detach",
    sql: earliestEventSql("sends", "asset.asset ref,'asset' typ", {
      where: "send_type='detach'",
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  // asset-PROPERTY firsts — from the ISSUANCES table (the EVENT that first set the property), NOT the assets
  // current-state table. e.g. first LOCKED = first valid issuance with locked=1, not the oldest now-locked asset.
  { key: "locked", label: "First locked issuance", sql: earliestValidIssuanceSql(`locked=1`) },
  { key: "divisible", label: "First divisible asset", sql: earliestValidIssuanceSql(`divisible=1`) },
  { key: "indivisible", label: "First indivisible asset", sql: earliestValidIssuanceSql(`divisible=0`) },
  { key: "one_of_one", label: "First 1/1 (single edition)", sql: earliestLockedSupplySql(1, "x.divisible=0") },
  { key: "numeric_one_of_one", label: "First numeric 1/1", sql: earliestLockedSupplySql(1, "x.divisible=0 AND asset.asset GLOB 'A[0-9]*'") },
  { key: "subasset_one_of_one", label: "First subasset 1/1", sql: earliestLockedSupplySql(1, "x.divisible=0 AND x.asset_longname IS NOT NULL") },
  { key: "satoshi_nft", label: "First one-satoshi NFT", sql: earliestLockedSupplySql(1, "x.divisible=1") },
  { key: "tokenless", label: "First locked tokenless asset", sql: earliestLockedSupplySql(0, "1=1") },
  { key: "reset", label: "First asset reset (CIP03)", sql: earliestValidIssuanceSql(`reset=1`) },
  { key: "transfer", label: "First asset transfer", sql: earliestValidIssuanceSql(`transfer=1`) },
  { key: "callable", label: "First callable asset", sql: earliestValidIssuanceSql(`callable=1`) },
  { key: "description", label: "First asset description", sql: earliestValidIssuanceSql(`description IS NOT NULL AND description!=''`) },
  { key: "non_ascii_description", label: "First non-ASCII asset description", sql: earliestValidIssuanceSql(`description GLOB '*[^ -~]*'`) },
  { key: "embedded_image", label: "First embedded data-URI image", sql: earliestValidIssuanceSql(`LOWER(description) LIKE 'data:image%'`) },
  { key: "description_url", label: "First external URL in an asset description", sql: earliestValidIssuanceSql(`LOWER(description) LIKE '%http://%' OR LOWER(description) LIKE '%https://%'`) },
  { key: "pepe_mention", label: "First Pepe mention in an asset description", sql: earliestValidIssuanceSql(`UPPER(description) LIKE '%PEPE%'`) },
  { key: "nft_term", label: "First use of “NFT” in an asset description", sql: earliestValidIssuanceSql(`UPPER(description) LIKE '%NFT%'`) },
  { key: "description_lock", label: "First locked asset description", sql: earliestValidIssuanceSql(`asset_events='lock_description'`) },
  { key: "json_desc", label: "First JSON description", sql: earliestValidIssuanceSql(`TRIM(description) LIKE '{%'`) },
  {
    key: "inscription",
    label: "First Counterparty inscription",
    sql: earliestValidIssuanceSql(`mime_type IS NOT NULL AND mime_type NOT IN ('','text/plain')`),
  },
  { key: "easyasset", label: "First EasyAsset", sql: earliestValidIssuanceSql(`lower(description) LIKE '%easyasset%'`) },
  {
    key: "fairminter",
    label: "First fairminter",
    sql: earliestEventSql("fairminters", "asset.asset ref,'asset' typ", {
      valid: true,
      by: "x.tx_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "fairminter_premint",
    label: "First preminted fairminter",
    sql: earliestEventSql("fairminters", "asset.asset ref,'asset' typ", {
      where: "CAST(premint_quantity AS INTEGER)>0",
      valid: true,
      by: "x.tx_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "fairminter_commission",
    label: "First commissioned fairminter",
    sql: earliestEventSql("fairminters", "asset.asset ref,'asset' typ", {
      where: "CAST(minted_asset_commission_int AS INTEGER)>0",
      valid: true,
      by: "x.tx_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "fairminter_burn_payment",
    label: "First burn-paid fairminter",
    sql: earliestEventSql("fairminters", "asset.asset ref,'asset' typ", {
      where: "burn_payment=1",
      valid: true,
      by: "x.tx_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "fairmint",
    label: "First fairmint",
    sql: earliestEventSql("fairmints", "asset.asset ref,'asset' typ", {
      valid: true,
      by: "x.event_index",
      joins: "JOIN asset_dictionary asset ON asset.asset_id=x.asset_id",
    }),
  },
  {
    key: "pool_deposit",
    label: "First pool deposit",
    sql: earliestEventSql("pool_liquidity", "asset_a.asset||' / '||asset_b.asset ref,'pair' typ", {
      where: "kind='deposit'",
      valid: true,
      by: "x.tx_index,x.event_index",
      joins: "JOIN asset_dictionary asset_a ON asset_a.asset_id=x.asset_a_id JOIN asset_dictionary asset_b ON asset_b.asset_id=x.asset_b_id",
    }),
  },
  {
    key: "pool_swap",
    label: "First pool swap",
    sql: earliestEventSql("pool_matches", "COALESCE(x.pair,x.lp_asset) ref,'pair' typ", { by: "x.tx_index,x.event_index", valid: true }),
  },
  // --- derived firsts (our classification layer) ---
  // CURATED: the canonical first Bitcoin Stamp (Stamp #0) is protocol-defined — it must be a NUMERIC asset AND
  // pass keyburn validation, which we can't derive from Counterparty alone (multiple stamp: assets share the
  // genesis block 779652). The community/protocol Stamp #0 is A7337447728884561000; we display its real block/date.
  {
    key: "stamp",
    label: "First Bitcoin Stamp",
    sql: `SELECT issuance.block_index b,issuance.block_time t,asset.asset ref,'asset' typ,LOWER(HEX(issuance.tx_hash)) tx
      FROM issuances issuance JOIN asset_dictionary asset ON asset.asset_id=issuance.asset_id
      WHERE asset.asset='A7337447728884561000' AND issuance.status NOT LIKE 'invalid%'
      ORDER BY issuance.block_index,issuance.event_index LIMIT 1`,
  },
  {
    key: "src20",
    label: "First SRC-20 token",
    sql: `SELECT issuance.block_index b,issuance.block_time t,asset.asset ref,'asset' typ,LOWER(HEX(issuance.tx_hash)) tx
      FROM tags tag JOIN entity_dictionary entity ON entity.entity_id=tag.entity_id AND entity.entity_type='asset'
      JOIN asset_dictionary asset ON asset.asset=entity.entity_key
      JOIN issuances issuance ON issuance.asset_id=asset.asset_id
      WHERE tag.tag='src20' AND issuance.status NOT LIKE 'invalid%'
        AND instr(lower(issuance.description),'stamp:')>0
      ORDER BY issuance.block_index,issuance.event_index LIMIT 1`,
  },
  {
    key: "src721",
    label: "First SRC-721 token",
    sql: `SELECT issuance.block_index b,issuance.block_time t,asset.asset ref,'asset' typ,LOWER(HEX(issuance.tx_hash)) tx
      FROM tags tag JOIN entity_dictionary entity ON entity.entity_id=tag.entity_id AND entity.entity_type='asset'
      JOIN asset_dictionary asset ON asset.asset=entity.entity_key
      JOIN issuances issuance ON issuance.asset_id=asset.asset_id
      WHERE tag.tag='src721' AND issuance.status NOT LIKE 'invalid%'
        AND instr(lower(issuance.description),'stamp:')>0
      ORDER BY issuance.block_index,issuance.event_index LIMIT 1`,
  },
  {
    key: "btns",
    label: "First BTNS broadcast",
    sql: earliestEventSql("broadcasts", "source.address ref,'address' typ", {
      where: "btns=1",
      valid: true,
      by: "x.tx_index",
      joins: "JOIN address_dictionary source ON source.address_id=x.source_id",
    }),
  },
];

/** Run one firsts SQL; null on any error (a table may be empty on a fresh mirror). */
export function queryFirstRecord(db: D1Database, sql: string): Promise<FirstQueryRow | null> {
  return one<FirstQueryRow>(db, sql).catch(() => null);
}
