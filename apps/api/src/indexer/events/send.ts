/** The SEND family: plain SEND, ENHANCED_SEND, multi-recipient MPMA_SEND (one event per leg), and the
 *  UTXO operations ATTACH_TO_UTXO / DETACH_FROM_UTXO / UTXO_MOVE. Balances move via CREDIT/DEBIT (see
 *  balance.ts); here we record the send row, incl. utxo<->address provenance and the attach gas fee.
 *  Invalid sends are indexed too (marked by status; they emit no CREDIT/DEBIT so balances are unaffected). */
import { type Handler, cap } from "#api/indexer/events/context";
import { normalize } from "#api/indexer/codec";
import { hashToBytes } from "#api/indexer/compact-codec";
const send: Handler = ({ ev, p, b, bt, div }, ctx) => {
  const stype =
    ev.event === "ENHANCED_SEND"
      ? "enhanced_send"
      : ev.event === "MPMA_SEND"
        ? "mpma"
        : ev.event === "ATTACH_TO_UTXO"
          ? "attach"
          : ev.event === "DETACH_FROM_UTXO"
            ? "detach"
            : ev.event === "UTXO_MOVE"
              ? "move"
              : "send";
  for (const address of [p.source, p.destination, p.source_address, p.destination_address]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  if (p.asset) ctx.identities.assets.add(String(p.asset));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO sends
           (event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,source_address_id,
            destination_address_id,asset_id,quantity,quantity_normalized,memo,memo_hex,send_type,status,
            fee_paid,msg_index)
         VALUES (?,?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,?,?)
         ON CONFLICT(event_index) DO UPDATE SET
           tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,destination_id=excluded.destination_id,
           source_address_id=excluded.source_address_id,destination_address_id=excluded.destination_address_id,
           asset_id=excluded.asset_id,quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
           memo=excluded.memo,memo_hex=excluded.memo_hex,send_type=excluded.send_type,status=excluded.status,
           fee_paid=excluded.fee_paid,msg_index=excluded.msg_index`,
      )
      .bind(
        ev.event_index,
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        p.source_address ?? null,
        p.destination_address ?? null,
        p.asset ?? null,
        p.quantity != null ? String(p.quantity) : null,
        p.quantity_normalized ?? normalize(p.quantity, div),
        cap(p.memo),
        p.memo_hex ?? null,
        stype,
        p.status ?? "valid",
        p.fee_paid != null ? String(p.fee_paid) : null,
        p.msg_index ?? 0,
      ),
  );
};
export const sends: Record<string, Handler> = {
  SEND: send,
  ENHANCED_SEND: send,
  MPMA_SEND: send,
  ATTACH_TO_UTXO: send,
  DETACH_FROM_UTXO: send,
  UTXO_MOVE: send,
};
