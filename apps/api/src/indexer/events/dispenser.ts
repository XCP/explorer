/** Dispensers (automated vending): OPEN_DISPENSER creates one; DISPENSER_UPDATE carries every per-dispense
 *  and close state change (give_remaining/dispense_count/status/scheduled close); REFILL_DISPENSER is its
 *  own history row (the dispenser's counters reset arrives separately via DISPENSER_UPDATE); DISPENSE is a
 *  single buy. Escrow in/out flows through CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "#api/indexer/events/context";
import { normalize } from "#api/indexer/codec";
import { hashToBytes } from "#api/indexer/compact-codec";
const open: Handler = ({ p, b, bt, div }, ctx) => {
  for (const address of [p.source, p.oracle_address, p.origin]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  if (p.asset) ctx.identities.assets.add(String(p.asset));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO dispensers
           (tx_index,tx_hash,block_index,block_time,source_id,asset_id,give_quantity,give_quantity_normalized,
            escrow_quantity,give_remaining,give_remaining_normalized,satoshirate,satoshirate_normalized,status,
            oracle_address_id,dispense_count,closed_block_index,origin_id,last_status_tx_hash)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),?,NULL,
           (SELECT address_id FROM address_dictionary WHERE address=?),NULL)
         ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,asset_id=excluded.asset_id,
           give_quantity=excluded.give_quantity,give_quantity_normalized=excluded.give_quantity_normalized,
           escrow_quantity=excluded.escrow_quantity,give_remaining=excluded.give_remaining,
           give_remaining_normalized=excluded.give_remaining_normalized,satoshirate=excluded.satoshirate,
           satoshirate_normalized=excluded.satoshirate_normalized,status=excluded.status,
           oracle_address_id=excluded.oracle_address_id,dispense_count=excluded.dispense_count,
           closed_block_index=excluded.closed_block_index,origin_id=excluded.origin_id,
           last_status_tx_hash=excluded.last_status_tx_hash`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.asset ?? null,
        str(p.give_quantity),
        p.give_quantity_normalized ?? normalize(p.give_quantity, div),
        str(p.escrow_quantity),
        str(p.give_remaining),
        p.give_remaining_normalized ?? normalize(p.give_remaining, div),
        str(p.satoshirate),
        p.satoshirate_normalized ?? null,
        p.status ?? 0,
        p.oracle_address ?? null,
        p.dispense_count ?? 0,
        p.origin ?? null,
      ),
  );
};
const update: Handler = ({ p, b }, ctx) => {
  if (p.tx_hash) {
    ctx.stmts.push((db) =>
      db
        .prepare(
          `UPDATE dispensers SET status=coalesce(?,status),give_remaining=coalesce(?,give_remaining),
             give_remaining_normalized=coalesce(?,give_remaining_normalized),
             dispense_count=coalesce(?,dispense_count),last_status_tx_hash=coalesce(?,last_status_tx_hash),
             closed_block_index=CASE WHEN ? IS NOT NULL THEN ? WHEN ?>=10 THEN ? ELSE closed_block_index END
           WHERE tx_hash=?`,
        )
        .bind(
          p.status ?? null,
          p.give_remaining != null ? String(p.give_remaining) : null,
          p.give_remaining_normalized ?? null,
          p.dispense_count ?? null,
          hashToBytes(p.last_status_tx_hash),
          p.close_block_index ?? null,
          p.close_block_index ?? null,
          p.status ?? -1,
          b,
          hashToBytes(p.tx_hash),
        ),
    );
  }
};
const refill: Handler = ({ ev, p, b, bt }, ctx) => {
  for (const address of [p.source, p.destination]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  if (p.asset) ctx.identities.assets.add(String(p.asset));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO dispenser_refills
           (event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,asset_id,
            dispense_quantity,dispenser_tx_index)
         VALUES (?,?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,
           (SELECT tx_index FROM transactions WHERE tx_hash=?))
         ON CONFLICT(event_index) DO UPDATE SET tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,
           block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
           destination_id=excluded.destination_id,asset_id=excluded.asset_id,
           dispense_quantity=excluded.dispense_quantity,dispenser_tx_index=excluded.dispenser_tx_index`,
      )
      .bind(
        ev.event_index,
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        p.asset ?? null,
        str(p.dispense_quantity),
        hashToBytes(p.dispenser_tx_hash),
      ),
  );
};
const dispense: Handler = ({ ev, p, b, bt, div }, ctx) => {
  for (const address of [p.source, p.destination]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  if (p.asset) ctx.identities.assets.add(String(p.asset));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO dispenses
           (event_index,tx_index,dispense_index,tx_hash,dispenser_tx_index,source_id,destination_id,asset_id,
            dispense_quantity,dispense_quantity_normalized,btc_amount,block_index,block_time)
         VALUES (?,?,?,?,(SELECT tx_index FROM transactions WHERE tx_hash=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?)
         ON CONFLICT(event_index) DO UPDATE SET tx_index=excluded.tx_index,
           dispense_index=excluded.dispense_index,tx_hash=excluded.tx_hash,
           dispenser_tx_index=excluded.dispenser_tx_index,source_id=excluded.source_id,
           destination_id=excluded.destination_id,asset_id=excluded.asset_id,
           dispense_quantity=excluded.dispense_quantity,
           dispense_quantity_normalized=excluded.dispense_quantity_normalized,
           btc_amount=excluded.btc_amount,block_index=excluded.block_index,block_time=excluded.block_time`,
      )
      .bind(
        ev.event_index,
        p.tx_index,
        p.dispense_index ?? 0,
        hashToBytes(p.tx_hash),
        hashToBytes(p.dispenser_tx_hash),
        p.source ?? null,
        p.destination ?? null,
        p.asset ?? null,
        str(p.dispense_quantity),
        p.dispense_quantity_normalized ?? normalize(p.dispense_quantity, div),
        str(p.btc_amount),
        b,
        bt,
      ),
  );
};
export const dispensers: Record<string, Handler> = {
  OPEN_DISPENSER: open,
  DISPENSER_UPDATE: update,
  REFILL_DISPENSER: refill,
  DISPENSE: dispense,
};
