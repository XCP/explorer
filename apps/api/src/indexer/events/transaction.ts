/** NEW_TRANSACTION: the raw Counterparty transaction envelope. `data` is intentionally not stored (blob; can be
 *  megabytes for stamps — images live in R2). */
import type { Handler } from "./context";

const newTransaction: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO transactions (tx_index,tx_hash,block_index,block_time,source,destination,btc_amount,fee,data,supported,utxos_info)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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
