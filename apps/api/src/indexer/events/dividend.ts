/** ASSET_DIVIDEND — pays holders of `asset` a per-unit amount of `dividend_asset`. Per-holder credits +
 *  the source debit + the XCP fee all emit CREDIT/DEBIT (balance.ts); the fee is also part of deterministic
 *  XCP supply. Here we record the dividend declaration. */
import { type Handler, str } from "#api/indexer/events/context";

const dividend: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO dividends (tx_hash,block_index,block_time,source,asset,dividend_asset,quantity_per_unit,quantity_per_unit_normalized,fee_paid,status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        p.tx_hash,
        b,
        bt,
        p.source ?? null,
        p.asset ?? null,
        p.dividend_asset ?? null,
        str(p.quantity_per_unit),
        p.quantity_per_unit_normalized ?? null,
        str(p.fee_paid),
        p.status ?? "valid",
      ),
  );
};

export const dividends: Record<string, Handler> = { ASSET_DIVIDEND: dividend };
