/** NEW_TRANSACTION: the raw Counterparty transaction envelope. `data` is intentionally not stored (blob; can be
 *  megabytes for stamps — images live in R2). */
import type { Handler } from "#api/indexer/events/context";
import { hashToBytes } from "#api/indexer/compact-codec";
const newTransaction: Handler = ({ p, b, bt }, ctx) => {
  if (p.source) ctx.identities.addresses.add(String(p.source));
  if (p.destination) ctx.identities.addresses.add(String(p.destination));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO transactions
           (tx_index,tx_hash,block_index,block_time,source_id,destination_id,btc_amount,fee,supported,utxos_info)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET
           tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
           source_id=excluded.source_id,destination_id=excluded.destination_id,btc_amount=excluded.btc_amount,
           fee=excluded.fee,supported=excluded.supported,utxos_info=excluded.utxos_info`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        p.btc_amount != null ? String(p.btc_amount) : null,
        p.fee != null ? String(p.fee) : null,
        p.supported === false ? 0 : 1,
        p.utxos_info ?? null,
      ),
  );
};
export const transaction: Record<string, Handler> = { NEW_TRANSACTION: newTransaction };
