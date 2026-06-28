/**
 * /v2/firsts — Counterparty's origin story: the earliest record of each kind of on-chain moment, with date
 * and the entity (linkable). Each "first" is the earliest row in an event/state table (block_index indexed,
 * so each is an instant index seek). Includes our derived firsts (stamp/SRC-20/SRC-721/BTNS) from the tag
 * + classification layer. Pure read off the mirror; cached an hour (history doesn't change).
 */
import { router, J } from "./shared";

export const firsts = router();

// each sql returns: b (block index), t (unix block time), ref (display + link id), typ (entity type for linking)
type First = { key: string; label: string; sql: string };
const FIRSTS: First[] = [
  // --- protocol genesis ---
  { key: "block",        label: "First block",            sql: `SELECT block_index b, block_time t, CAST(block_index AS TEXT) ref, 'block' typ FROM blocks ORDER BY block_index LIMIT 1` },
  { key: "transaction",  label: "First transaction",      sql: `SELECT block_index b, block_time t, tx_hash ref, 'tx' typ FROM transactions ORDER BY block_index, tx_index LIMIT 1` },
  { key: "burn",         label: "First XCP burn",         sql: `SELECT block_index b, block_time t, source ref, 'address' typ FROM burns ORDER BY block_index, rowid LIMIT 1` },
  // --- assets ---
  { key: "asset",        label: "First asset issued",     sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM issuances ORDER BY block_index, tx_index LIMIT 1` },
  { key: "subasset",     label: "First subasset",         sql: `SELECT first_issuance_block_index b, first_issuance_block_time t, asset ref, 'asset' typ FROM assets WHERE type='subasset' ORDER BY first_issuance_block_index LIMIT 1` },
  { key: "numeric",      label: "First numeric asset",    sql: `SELECT first_issuance_block_index b, first_issuance_block_time t, asset ref, 'asset' typ FROM assets WHERE type='numeric' ORDER BY first_issuance_block_index LIMIT 1` },
  { key: "destruction",  label: "First destruction",      sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM destructions ORDER BY block_index, event_index LIMIT 1` },
  // --- transfers & markets ---
  { key: "send",         label: "First send",             sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM sends ORDER BY block_index, tx_index LIMIT 1` },
  { key: "order",        label: "First DEX order",        sql: `SELECT block_index b, block_time t, tx_hash ref, 'tx' typ FROM orders ORDER BY block_index, rowid LIMIT 1` },
  { key: "order_match",  label: "First order match",      sql: `SELECT block_index b, block_time t, tx0_hash ref, 'tx' typ FROM order_matches ORDER BY block_index, rowid LIMIT 1` },
  { key: "dispenser",    label: "First dispenser",        sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM dispensers ORDER BY block_index, rowid LIMIT 1` },
  { key: "dispense",     label: "First dispense",         sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM dispenses ORDER BY block_index, event_index LIMIT 1` },
  // --- other message types ---
  { key: "dividend",     label: "First dividend",         sql: `SELECT block_index b, block_time t, asset ref, 'asset' typ FROM dividends ORDER BY block_index, rowid LIMIT 1` },
  { key: "broadcast",    label: "First broadcast",        sql: `SELECT block_index b, block_time t, source ref, 'address' typ FROM broadcasts ORDER BY block_index, rowid LIMIT 1` },
  { key: "bet",          label: "First bet",              sql: `SELECT block_index b, block_time t, source ref, 'address' typ FROM bets ORDER BY block_index, rowid LIMIT 1` },
  { key: "sweep",        label: "First sweep",            sql: `SELECT block_index b, block_time t, source ref, 'address' typ FROM sweeps ORDER BY block_index, rowid LIMIT 1` },
  { key: "cancel",       label: "First cancel",           sql: `SELECT block_index b, block_time t, tx_hash ref, 'tx' typ FROM cancels ORDER BY block_index, rowid LIMIT 1` },
  { key: "btcpay",       label: "First BTC pay",          sql: `SELECT block_index b, block_time t, tx_hash ref, 'tx' typ FROM btcpays ORDER BY block_index, rowid LIMIT 1` },
  { key: "locked",       label: "First locked asset",     sql: `SELECT first_issuance_block_index b, first_issuance_block_time t, asset ref, 'asset' typ FROM assets WHERE locked=1 ORDER BY first_issuance_block_index LIMIT 1` },
  { key: "one_of_one",   label: "First 1/1 (single edition)", sql: `SELECT first_issuance_block_index b, first_issuance_block_time t, asset ref, 'asset' typ FROM assets WHERE divisible=0 AND locked=1 AND CAST(supply_normalized AS REAL)=1 ORDER BY first_issuance_block_index LIMIT 1` },
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

firsts.get("/v2/firsts", async (c) => {
  const rows = await Promise.all(FIRSTS.map(async (f) => {
    const r = await c.env.DB.prepare(f.sql).first<any>().catch(() => null);
    if (!r || r.b == null) return null;
    const t = Number(r.t) || 0;
    return { key: f.key, label: f.label, block: r.b, time: t, date: new Date(t * 1000).toISOString().slice(0, 10), ref: r.ref, type: r.typ };
  }));
  return J(c, { result: rows.filter(Boolean).sort((a, b) => (a!.block - b!.block)) }, 3600);
});
