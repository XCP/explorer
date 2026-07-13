/** NEW_TRANSACTION: the raw Counterparty transaction envelope. `data` is intentionally not stored (blob; can be
 *  megabytes for stamps — images live in R2). */
import type { Handler } from "#api/indexer/events/context";

const newTransaction: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO transactions (tx_index,tx_hash,block_index,block_time,source,destination,btc_amount,fee,data,supported,utxos_info)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET
           tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
           source=excluded.source,destination=excluded.destination,btc_amount=excluded.btc_amount,
           fee=excluded.fee,data=excluded.data,supported=excluded.supported,utxos_info=excluded.utxos_info`,
      )
      .bind(
        p.tx_index,
        p.tx_hash,
        b,
        bt,
        p.source ?? null,
        p.destination ?? null,
        p.btc_amount != null ? String(p.btc_amount) : null,
        p.fee != null ? String(p.fee) : null,
        null,
        p.supported === false ? 0 : 1,
        p.utxos_info ?? null,
      ),
  );
};

export const transaction: Record<string, Handler> = { NEW_TRANSACTION: newTransaction };
