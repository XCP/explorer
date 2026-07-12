/** ASSET_DESTRUCTION — burns supply (incl. XCP fee-burns like the attach-to-utxo gas fee, which CP
 *  records here). Lowers supply, so the asset is enqueued for deterministic recompute. */
import { type Handler, str } from "#api/indexer/events/context";
import { normalize } from "#api/indexer/codec";

const destroy: Handler = ({ ev, p, b, bt, div }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO destructions (event_index,tx_hash,block_index,block_time,source,asset,quantity,quantity_normalized,tag,status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ev.event_index,
        p.tx_hash ?? null,
        b,
        bt,
        p.source ?? null,
        p.asset ?? null,
        str(p.quantity),
        p.quantity_normalized ?? normalize(p.quantity, div),
        p.tag ?? null,
        p.status ?? "valid",
      ),
  );
  if (p.asset && (p.status ?? "valid") === "valid") ctx.supplyDirty.add(p.asset);
};

export const destroy_: Record<string, Handler> = { ASSET_DESTRUCTION: destroy };
