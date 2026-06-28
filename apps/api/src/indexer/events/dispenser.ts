/** Dispensers (automated vending): OPEN_DISPENSER creates one; DISPENSER_UPDATE carries every per-dispense
 *  and close state change (give_remaining/dispense_count/status/scheduled close); REFILL_DISPENSER is its
 *  own history row (the dispenser's counters reset arrives separately via DISPENSER_UPDATE); DISPENSE is a
 *  single buy. Escrow in/out flows through CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "./context";
import { normalize } from "../codec";

const open: Handler = ({ p, b, bt, div }, ctx) => {
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR REPLACE INTO dispensers (tx_hash,block_index,block_time,source,asset,give_quantity,give_quantity_normalized,escrow_quantity,give_remaining,give_remaining_normalized,satoshirate,satoshirate_normalized,status,oracle_address,dispense_count,closed_block_index,origin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`
  ).bind(p.tx_hash, b, bt, p.source ?? null, p.asset ?? null,
         str(p.give_quantity), p.give_quantity_normalized ?? normalize(p.give_quantity, div),
         str(p.escrow_quantity), str(p.give_remaining), p.give_remaining_normalized ?? normalize(p.give_remaining, div),
         str(p.satoshirate), p.satoshirate_normalized ?? null, p.status ?? 0, p.oracle_address ?? null, p.dispense_count ?? 0, p.origin ?? null));
};

const update: Handler = ({ p, b }, ctx) => {
  // Use CP's scheduled close_block_index when present (delayed CLOSING -> CLOSED), else stamp this
  // event's block on any close (status>=10).
  ctx.stmts.push((db) => db.prepare(
    `UPDATE dispensers SET status=COALESCE(?,status), give_remaining=COALESCE(?,give_remaining),
       give_remaining_normalized=COALESCE(?,give_remaining_normalized), dispense_count=COALESCE(?,dispense_count),
       last_status_tx_hash=COALESCE(?,last_status_tx_hash),
       closed_block_index=CASE WHEN ? IS NOT NULL THEN ? WHEN ?>=10 THEN ? ELSE closed_block_index END
     WHERE tx_hash=?`
  ).bind(p.status ?? null, p.give_remaining != null ? String(p.give_remaining) : null,
         p.give_remaining_normalized ?? null, p.dispense_count ?? null, p.last_status_tx_hash ?? null,
         p.close_block_index ?? null, p.close_block_index ?? null, p.status ?? -1, b, p.tx_hash));
};

const refill: Handler = ({ ev, p, b, bt }, ctx) => {
  // p.tx_hash is the REFILL tx; dispenser_tx_hash points at the dispenser it tops up.
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR IGNORE INTO dispenser_refills (event_index,tx_hash,block_index,block_time,source,destination,asset,dispense_quantity,dispenser_tx_hash)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(ev.event_index, p.tx_hash ?? null, b, bt, p.source ?? null, p.destination ?? null, p.asset ?? null,
         str(p.dispense_quantity), p.dispenser_tx_hash ?? null));
};

const dispense: Handler = ({ ev, p, b, bt, div }, ctx) => {
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR IGNORE INTO dispenses (event_index,tx_hash,dispense_index,dispenser_tx_hash,source,destination,asset,dispense_quantity,dispense_quantity_normalized,btc_amount,block_index,block_time)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(ev.event_index, p.tx_hash ?? null, p.dispense_index ?? null, p.dispenser_tx_hash ?? null, p.source ?? null, p.destination ?? null,
         p.asset ?? null, str(p.dispense_quantity), p.dispense_quantity_normalized ?? normalize(p.dispense_quantity, div),
         str(p.btc_amount), b, bt));
};

export const dispensers: Record<string, Handler> = {
  OPEN_DISPENSER: open, DISPENSER_UPDATE: update, REFILL_DISPENSER: refill, DISPENSE: dispense,
};
