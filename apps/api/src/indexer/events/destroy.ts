/** ASSET_DESTRUCTION — burns supply (incl. XCP fee-burns like the attach-to-utxo gas fee, which CP
 *  records here). Lowers supply, so the asset is enqueued for deterministic recompute. */
import { type Handler, str } from "#api/indexer/events/context";
import { normalize } from "#api/indexer/codec";
import { hashToBytes } from "#api/indexer/identities";
const destroy: Handler = ({ ev, p, b, bt, div }, ctx) => {
  {
    if (p.source) ctx.identities.addresses.add(String(p.source));
    if (p.asset) ctx.identities.assets.add(String(p.asset));
    ctx.stmts.push((db) =>
      db
        .prepare(
          `INSERT INTO destructions
             (event_index,tx_index,tx_hash,block_index,block_time,source_id,asset_id,quantity,
              quantity_normalized,tag,status)
           VALUES (?,?,?,?,?,
             (SELECT address_id FROM address_dictionary WHERE address=?),
             (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?)
           ON CONFLICT(event_index) DO UPDATE SET tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,
             block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
             asset_id=excluded.asset_id,quantity=excluded.quantity,
             quantity_normalized=excluded.quantity_normalized,tag=excluded.tag,status=excluded.status`,
        )
        .bind(
          ev.event_index,
          p.tx_index,
          hashToBytes(p.tx_hash),
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
  }
  if (p.asset && (p.status ?? "valid") === "valid") ctx.supplyDirty.add(p.asset);
};
export const destroy_: Record<string, Handler> = { ASSET_DESTRUCTION: destroy };
