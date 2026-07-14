/** The DEX: OPEN_ORDER + lifecycle (ORDER_UPDATE/FILLED/CANCEL/EXPIRATION), ORDER_MATCH and its
 *  status-only updates, and BTC_PAY (completes a BTC-leg match). Counterparty's *_UPDATE events carry only changed
 *  fields, so they UPDATE — never re-INSERT (which would wipe the row). Escrow/settlement balances flow
 *  through CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "#api/indexer/events/context";
import { hashToBytes, parseMatchId } from "#api/indexer/identities";
function matchId(p: Record<string, unknown>): string {
  return String(p.order_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`);
}
const open: Handler = ({ p, b, bt }, ctx) => {
  if (p.source) ctx.identities.addresses.add(String(p.source));
  if (p.give_asset) ctx.identities.assets.add(String(p.give_asset));
  if (p.get_asset) ctx.identities.assets.add(String(p.get_asset));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO orders
           (tx_index,tx_hash,block_index,block_time,source_id,give_asset_id,give_quantity,give_remaining,
            get_asset_id,get_quantity,get_remaining,expiration,expire_index,fee_required,fee_required_remaining,
            fee_provided,fee_provided_remaining,status,closed_block_index)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,?,?,?,NULL)
         ON CONFLICT(tx_index) DO UPDATE SET
           tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
           source_id=excluded.source_id,give_asset_id=excluded.give_asset_id,
           give_quantity=excluded.give_quantity,give_remaining=excluded.give_remaining,
           get_asset_id=excluded.get_asset_id,get_quantity=excluded.get_quantity,
           get_remaining=excluded.get_remaining,expiration=excluded.expiration,expire_index=excluded.expire_index,
           fee_required=excluded.fee_required,fee_required_remaining=excluded.fee_required_remaining,
           fee_provided=excluded.fee_provided,fee_provided_remaining=excluded.fee_provided_remaining,
           status=excluded.status,closed_block_index=excluded.closed_block_index`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.give_asset ?? null,
        str(p.give_quantity),
        str(p.give_remaining ?? p.give_quantity),
        p.get_asset ?? null,
        str(p.get_quantity),
        str(p.get_remaining ?? p.get_quantity),
        p.expiration ?? null,
        p.expire_index ?? null,
        str(p.fee_required),
        str(p.fee_required_remaining ?? p.fee_required),
        str(p.fee_provided),
        str(p.fee_provided_remaining ?? p.fee_provided),
        p.status ?? "open",
      ),
  );
};
// ORDER_UPDATE / ORDER_FILLED / CANCEL_ORDER / ORDER_EXPIRATION. Apply remainings ALWAYS (COALESCE keeps
// prior when absent); a reopen (status='open', e.g. after match expiration) must also clear closed_block_index.
const status: Handler = ({ ev, p, b, bt }, ctx) => {
  const st =
    ev.event === "ORDER_EXPIRATION"
      ? "expired"
      : ev.event === "CANCEL_ORDER"
        ? "cancelled"
        : ev.event === "ORDER_FILLED"
          ? "filled"
          : (p.status ?? null);
  // CANCEL_ORDER's tx_hash is the cancel TX; the order it cancels is offer_hash/order_hash.
  const hash =
    ev.event === "CANCEL_ORDER" ? (p.offer_hash ?? p.order_hash) : (p.tx_hash ?? p.offer_hash ?? p.order_hash);
  const gr = p.give_remaining != null ? String(p.give_remaining) : null;
  const xr = p.get_remaining != null ? String(p.get_remaining) : null;
  const frr = p.fee_required_remaining != null ? String(p.fee_required_remaining) : null;
  const fpr = p.fee_provided_remaining != null ? String(p.fee_provided_remaining) : null;
  if (hash) {
    const txHashBytes = hashToBytes(hash);
    if (st === null) {
      ctx.stmts.push((db) =>
        db
          .prepare(
            `UPDATE orders SET give_remaining=coalesce(?,give_remaining),get_remaining=coalesce(?,get_remaining),
               fee_required_remaining=coalesce(?,fee_required_remaining),
               fee_provided_remaining=coalesce(?,fee_provided_remaining) WHERE tx_hash=?`,
          )
          .bind(gr, xr, frr, fpr, txHashBytes),
      );
    } else if (st === "open") {
      ctx.stmts.push((db) =>
        db
          .prepare(
            `UPDATE orders SET give_remaining=coalesce(?,give_remaining),get_remaining=coalesce(?,get_remaining),
               fee_required_remaining=coalesce(?,fee_required_remaining),
               fee_provided_remaining=coalesce(?,fee_provided_remaining),status='open',closed_block_index=NULL
             WHERE tx_hash=?`,
          )
          .bind(gr, xr, frr, fpr, txHashBytes),
      );
    } else {
      ctx.stmts.push((db) =>
        db
          .prepare(
            `UPDATE orders SET status=?,closed_block_index=?,give_remaining=coalesce(?,give_remaining),
               get_remaining=coalesce(?,get_remaining),
               fee_required_remaining=coalesce(?,fee_required_remaining),
               fee_provided_remaining=coalesce(?,fee_provided_remaining) WHERE tx_hash=?`,
          )
          .bind(st, b, gr, xr, frr, fpr, txHashBytes),
      );
    }
  }
  // cancel txs are first-class records (who cancelled which offer) in addition to flipping the order
  if (ev.event === "CANCEL_ORDER" && p.tx_hash) {
    {
      if (p.source) ctx.identities.addresses.add(String(p.source));
      const offerHash = p.offer_hash ?? p.order_hash ?? null;
      ctx.stmts.push((db) =>
        db
          .prepare(
            `INSERT INTO cancels(tx_index,tx_hash,block_index,block_time,source_id,offer_tx_index,status)
             VALUES (?,?,?,?,(SELECT address_id FROM address_dictionary WHERE address=?),
               (SELECT tx_index FROM transactions WHERE tx_hash=?),?)
             ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
               block_time=excluded.block_time,source_id=excluded.source_id,
               offer_tx_index=excluded.offer_tx_index,status=excluded.status`,
          )
          .bind(
            p.tx_index,
            hashToBytes(p.tx_hash),
            b,
            bt,
            p.source ?? null,
            hashToBytes(offerHash),
            p.status ?? "valid",
          ),
      );
    }
  }
};
const match: Handler = ({ p, b, bt }, ctx) => {
  for (const address of [p.tx0_address, p.tx1_address]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  for (const asset of [p.forward_asset, p.backward_asset]) {
    if (asset) ctx.identities.assets.add(String(asset));
  }
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO order_matches
           (tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,tx1_address_id,forward_asset_id,
            forward_quantity,backward_asset_id,backward_quantity,block_index,block_time,status,
            match_expire_index,fee_paid,tx0_block_index,tx1_block_index,tx0_expiration,tx1_expiration)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx0_index,tx1_index) DO UPDATE SET
           tx0_hash=excluded.tx0_hash,tx1_hash=excluded.tx1_hash,
           tx0_address_id=excluded.tx0_address_id,tx1_address_id=excluded.tx1_address_id,
           forward_asset_id=excluded.forward_asset_id,forward_quantity=excluded.forward_quantity,
           backward_asset_id=excluded.backward_asset_id,backward_quantity=excluded.backward_quantity,
           block_index=excluded.block_index,block_time=excluded.block_time,status=excluded.status,
           match_expire_index=excluded.match_expire_index,fee_paid=excluded.fee_paid,
           tx0_block_index=excluded.tx0_block_index,tx1_block_index=excluded.tx1_block_index,
           tx0_expiration=excluded.tx0_expiration,tx1_expiration=excluded.tx1_expiration`,
      )
      .bind(
        p.tx0_index,
        p.tx1_index,
        hashToBytes(p.tx0_hash),
        hashToBytes(p.tx1_hash),
        p.tx0_address ?? null,
        p.tx1_address ?? null,
        p.forward_asset ?? null,
        str(p.forward_quantity),
        p.backward_asset ?? null,
        str(p.backward_quantity),
        b,
        bt,
        p.status ?? "completed",
        p.match_expire_index ?? null,
        p.fee_paid != null ? String(p.fee_paid) : null,
        p.tx0_block_index ?? null,
        p.tx1_block_index ?? null,
        p.tx0_expiration ?? null,
        p.tx1_expiration ?? null,
      ),
  );
};
const matchUpdate: Handler = ({ p }, ctx) => {
  {
    const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
    ctx.stmts.push((db) =>
      db
        .prepare(`UPDATE order_matches SET status=? WHERE tx0_hash=? AND tx1_hash=?`)
        .bind(p.status ?? "completed", tx0Hash, tx1Hash),
    );
  }
};
const matchExpire: Handler = ({ p }, ctx) => {
  {
    const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
    ctx.stmts.push((db) =>
      db.prepare(`UPDATE order_matches SET status='expired' WHERE tx0_hash=? AND tx1_hash=?`).bind(tx0Hash, tx1Hash),
    );
  }
};
const btcpay: Handler = ({ ev, p, b, bt }, ctx) => {
  for (const address of [p.source, p.destination]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO btcpays
           (event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,
            order_match_tx0_index,order_match_tx1_index,btc_amount,btc_amount_normalized,status)
         VALUES (?,?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT tx_index FROM transactions WHERE tx_hash=?),
           (SELECT tx_index FROM transactions WHERE tx_hash=?),?,?,?)
         ON CONFLICT(event_index) DO UPDATE SET
           tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,destination_id=excluded.destination_id,
           order_match_tx0_index=excluded.order_match_tx0_index,
           order_match_tx1_index=excluded.order_match_tx1_index,btc_amount=excluded.btc_amount,
           btc_amount_normalized=excluded.btc_amount_normalized,status=excluded.status`,
      )
      .bind(
        ev.event_index,
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        tx0Hash,
        tx1Hash,
        str(p.btc_amount),
        p.btc_amount_normalized ?? null,
        p.status ?? "valid",
      ),
  );
  ctx.stmts.push((db) =>
    db.prepare(`UPDATE order_matches SET status='completed' WHERE tx0_hash=? AND tx1_hash=?`).bind(tx0Hash, tx1Hash),
  );
};
export const orders: Record<string, Handler> = {
  OPEN_ORDER: open,
  ORDER_UPDATE: status,
  ORDER_FILLED: status,
  CANCEL_ORDER: status,
  ORDER_EXPIRATION: status,
  ORDER_MATCH: match,
  ORDER_MATCH_UPDATE: matchUpdate,
  ORDER_MATCH_EXPIRATION: matchExpire,
  BTC_PAY: btcpay,
};
