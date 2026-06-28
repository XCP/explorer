/** The SEND family: plain SEND, ENHANCED_SEND, multi-recipient MPMA_SEND (one event per leg), and the
 *  UTXO operations ATTACH_TO_UTXO / DETACH_FROM_UTXO / UTXO_MOVE. Balances move via CREDIT/DEBIT (see
 *  balance.ts); here we record the send row, incl. utxo<->address provenance and the attach gas fee.
 *  Invalid sends are indexed too (marked by status; they emit no CREDIT/DEBIT so balances are unaffected). */
import { type Handler, cap } from "./context";
import { normalize } from "../codec";

const send: Handler = ({ ev, p, b, bt, div }, ctx) => {
  const stype = ev.event === "ENHANCED_SEND" ? "enhanced_send" : ev.event === "MPMA_SEND" ? "mpma"
    : ev.event === "ATTACH_TO_UTXO" ? "attach" : ev.event === "DETACH_FROM_UTXO" ? "detach"
    : ev.event === "UTXO_MOVE" ? "move" : "send";
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR IGNORE INTO sends (event_index,tx_hash,block_index,block_time,source,destination,asset,quantity,quantity_normalized,memo,memo_hex,send_type,status,source_address,destination_address,fee_paid,msg_index,tx_index)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(ev.event_index, p.tx_hash ?? null, b, bt, p.source ?? null, p.destination ?? null, p.asset ?? null,
         p.quantity != null ? String(p.quantity) : null, p.quantity_normalized ?? normalize(p.quantity, div),
         cap(p.memo), p.memo_hex ?? null, stype, p.status ?? "valid",
         p.source_address ?? null, p.destination_address ?? null, p.fee_paid != null ? String(p.fee_paid) : null,
         p.msg_index ?? null, p.tx_index ?? null));
};

export const sends: Record<string, Handler> = {
  SEND: send, ENHANCED_SEND: send, MPMA_SEND: send,
  ATTACH_TO_UTXO: send, DETACH_FROM_UTXO: send, UTXO_MOVE: send,
};
