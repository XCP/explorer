/** BURN — BTC burned to create XCP (genesis-era mechanic). `earned` is the XCP minted; it's the
 *  positive term in the deterministic XCP supply (see asset-supply.ts). */
import { type Handler, str } from "#api/indexer/events/context";

const burn: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO burns (tx_hash,block_index,block_time,source,burned,burned_normalized,earned,earned_normalized,status) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx_hash) DO UPDATE SET block_index=excluded.block_index,block_time=excluded.block_time,source=excluded.source,burned=excluded.burned,burned_normalized=excluded.burned_normalized,earned=excluded.earned,earned_normalized=excluded.earned_normalized,status=excluded.status`,
      )
      .bind(
        p.tx_hash,
        b,
        bt,
        p.source ?? null,
        str(p.burned),
        p.burned_normalized ?? null,
        str(p.earned),
        p.earned_normalized ?? null,
        p.status ?? "valid",
      ),
  );
};

export const burns: Record<string, Handler> = { BURN: burn };
