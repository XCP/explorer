/** SWEEP — moves an address's entire balances and/or asset ownership to a destination. The balance moves
 *  emit CREDIT/DEBIT (balance.ts) and ownership transfers emit ASSET_TRANSFER (issuance.ts); here we just
 *  record the sweep row (flags/memo/fee). */
import { type Handler, str } from "#api/indexer/events/context";

const sweep: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO sweeps (tx_hash,block_index,block_time,source,destination,flags,memo,fee_paid,status) VALUES (?,?,?,?,?,?,?,?,?)`,
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
};

export const sweeps: Record<string, Handler> = { SWEEP: sweep, INVALID_SWEEP: sweep };
