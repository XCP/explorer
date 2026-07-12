/** The DEX: OPEN_ORDER + lifecycle (ORDER_UPDATE/FILLED/CANCEL/EXPIRATION), ORDER_MATCH and its
 *  status-only updates, and BTC_PAY (completes a BTC-leg match). Counterparty's *_UPDATE events carry only changed
 *  fields, so they UPDATE — never re-INSERT (which would wipe the row). Escrow/settlement balances flow
 *  through CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "#api/indexer/events/context";

const open: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO orders (tx_hash,block_index,block_time,source,give_asset,give_quantity,give_remaining,get_asset,get_quantity,get_remaining,expiration,expire_index,fee_required,fee_required_remaining,fee_provided,fee_provided_remaining,status,closed_block_index)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .bind(
        p.tx_hash,
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
  if (hash && st === null) {
    // a bare ORDER_UPDATE (remainings only) — never touch status/closed_block_index
    ctx.stmts.push((db) =>
      db
        .prepare(
          `UPDATE orders SET give_remaining=COALESCE(?,give_remaining), get_remaining=COALESCE(?,get_remaining), fee_required_remaining=COALESCE(?,fee_required_remaining), fee_provided_remaining=COALESCE(?,fee_provided_remaining) WHERE tx_hash=?`,
        )
        .bind(gr, xr, frr, fpr, hash),
    );
  } else if (hash && st === "open") {
    ctx.stmts.push((db) =>
      db
        .prepare(
          `UPDATE orders SET give_remaining=COALESCE(?,give_remaining), get_remaining=COALESCE(?,get_remaining), fee_required_remaining=COALESCE(?,fee_required_remaining), fee_provided_remaining=COALESCE(?,fee_provided_remaining), status='open', closed_block_index=NULL WHERE tx_hash=?`,
        )
        .bind(gr, xr, frr, fpr, hash),
    );
  } else if (hash) {
    ctx.stmts.push((db) =>
      db
        .prepare(
          `UPDATE orders SET status=?, closed_block_index=?, give_remaining=COALESCE(?,give_remaining), get_remaining=COALESCE(?,get_remaining), fee_required_remaining=COALESCE(?,fee_required_remaining), fee_provided_remaining=COALESCE(?,fee_provided_remaining) WHERE tx_hash=?`,
        )
        .bind(st, b, gr, xr, frr, fpr, hash),
    );
  }
  // cancel txs are first-class records (who cancelled which offer) in addition to flipping the order
  if (ev.event === "CANCEL_ORDER" && p.tx_hash) {
    ctx.stmts.push((db) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO cancels (tx_hash,block_index,block_time,source,offer_hash,status) VALUES (?,?,?,?,?,?)`,
        )
        .bind(p.tx_hash, b, bt, p.source ?? null, p.offer_hash ?? p.order_hash ?? null, p.status ?? "valid"),
    );
  }
};

const match: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO order_matches (id,tx0_hash,tx1_hash,tx0_address,tx1_address,forward_asset,forward_quantity,backward_asset,backward_quantity,block_index,block_time,status,match_expire_index,fee_paid,tx0_index,tx1_index,tx0_block_index,tx1_block_index,tx0_expiration,tx1_expiration)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        p.id ?? `${p.tx0_hash}_${p.tx1_hash}`,
        p.tx0_hash ?? null,
        p.tx1_hash ?? null,
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
        p.tx0_index ?? null,
        p.tx1_index ?? null,
        p.tx0_block_index ?? null,
        p.tx1_block_index ?? null,
        p.tx0_expiration ?? null,
        p.tx1_expiration ?? null,
      ),
  );
};

const matchUpdate: Handler = ({ p }, ctx) => {
  // carries only {order_match_id, status}
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE order_matches SET status=? WHERE id=?`)
      .bind(p.status ?? "completed", p.order_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`),
  );
};

const matchExpire: Handler = ({ p }, ctx) => {
  // BTC-pair specific (unpaid BTCPay -> match expires)
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE order_matches SET status='expired' WHERE id=?`)
      .bind(p.order_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`),
  );
};

const btcpay: Handler = ({ ev, p, b, bt }, ctx) => {
  // completes a BTC order match
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO btcpays (event_index,tx_hash,block_index,block_time,source,destination,order_match_id,btc_amount,btc_amount_normalized,status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ev.event_index,
        p.tx_hash ?? null,
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        p.order_match_id ?? null,
        str(p.btc_amount),
        p.btc_amount_normalized ?? null,
        p.status ?? "valid",
      ),
  );
  if (p.order_match_id)
    ctx.stmts.push((db) => db.prepare(`UPDATE order_matches SET status='completed' WHERE id=?`).bind(p.order_match_id));
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
