/** SWEEP — moves an address's entire balances and/or asset ownership to a destination. The balance moves
 *  emit CREDIT/DEBIT (balance.ts) and ownership transfers emit ASSET_TRANSFER (issuance.ts); here we just
 *  record the sweep row (flags/memo/fee). */
import { type Handler, str } from "#api/indexer/events/context";
import { hashToBytes } from "#api/indexer/compact-codec";

const sweep: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO sweeps (tx_hash,block_index,block_time,source,destination,flags,memo,fee_paid,status) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx_hash) DO UPDATE SET block_index=excluded.block_index,block_time=excluded.block_time,source=excluded.source,destination=excluded.destination,flags=excluded.flags,memo=excluded.memo,fee_paid=excluded.fee_paid,status=excluded.status`,
      )
      .bind(
        p.tx_hash,
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        p.flags ?? null,
        p.memo ?? null,
        str(p.fee_paid),
        p.status ?? "valid",
      ),
  );
  if (!ctx.compact) return;
  for (const address of [p.source, p.destination]) {
    if (address) ctx.compact.identities.addresses.add(String(address));
  }
  ctx.compact.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO sweeps
           (tx_index,tx_hash,block_index,block_time,source_id,destination_id,flags,memo,fee_paid,status)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,destination_id=excluded.destination_id,
           flags=excluded.flags,memo=excluded.memo,fee_paid=excluded.fee_paid,status=excluded.status`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        p.flags ?? null,
        p.memo ?? null,
        str(p.fee_paid),
        p.status ?? "valid",
      ),
  );
};

export const sweeps: Record<string, Handler> = { SWEEP: sweep, INVALID_SWEEP: sweep };
