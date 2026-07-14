/** Fairminters (fair-launch mints): NEW_FAIRMINTER defines the campaign; NEW_FAIRMINT is one mint (and
 *  Counterparty also emits a real ASSET_ISSUANCE per fairmint, so issuance.ts keeps supply correct — we just enqueue
 *  the asset for recompute); FAIRMINTER_UPDATE flips status. */
import { type Handler, str, cap } from "#api/indexer/events/context";
import { hashToBytes } from "#api/indexer/compact-codec";
const newFairminter: Handler = ({ p, b, bt }, ctx) => {
  if (p.source) ctx.identities.addresses.add(String(p.source));
  for (const asset of [p.asset, p.asset_parent]) {
    if (asset) ctx.identities.assets.add(String(asset));
  }
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO fairminters
           (tx_index,tx_hash,block_index,block_time,source_id,asset_id,asset_parent_id,asset_longname,description,
            price,quantity_by_price,hard_cap,burn_payment,max_mint_per_tx,premint_quantity,start_block,end_block,
            minted_asset_commission_int,soft_cap,soft_cap_deadline_block,lock_description,lock_quantity,divisible,
            pre_minted,status,max_mint_per_address,mime_type,pool_quantity,lp_asset)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,asset_id=excluded.asset_id,
           asset_parent_id=excluded.asset_parent_id,asset_longname=excluded.asset_longname,
           description=excluded.description,price=excluded.price,quantity_by_price=excluded.quantity_by_price,
           hard_cap=excluded.hard_cap,burn_payment=excluded.burn_payment,
           max_mint_per_tx=excluded.max_mint_per_tx,premint_quantity=excluded.premint_quantity,
           start_block=excluded.start_block,end_block=excluded.end_block,
           minted_asset_commission_int=excluded.minted_asset_commission_int,soft_cap=excluded.soft_cap,
           soft_cap_deadline_block=excluded.soft_cap_deadline_block,lock_description=excluded.lock_description,
           lock_quantity=excluded.lock_quantity,divisible=excluded.divisible,pre_minted=excluded.pre_minted,
           status=excluded.status,max_mint_per_address=excluded.max_mint_per_address,
           mime_type=excluded.mime_type,pool_quantity=excluded.pool_quantity,lp_asset=excluded.lp_asset`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.asset ?? null,
        p.asset_parent ?? null,
        p.asset_longname ?? null,
        cap(p.description),
        str(p.price),
        str(p.quantity_by_price),
        str(p.hard_cap),
        p.burn_payment ? 1 : 0,
        str(p.max_mint_per_tx),
        str(p.premint_quantity),
        p.start_block ?? null,
        p.end_block ?? null,
        str(p.minted_asset_commission_int),
        str(p.soft_cap),
        p.soft_cap_deadline_block ?? null,
        p.lock_description ? 1 : 0,
        p.lock_quantity ? 1 : 0,
        p.divisible ? 1 : 0,
        p.pre_minted ? 1 : 0,
        p.status ?? "open",
        str(p.max_mint_per_address),
        p.mime_type ?? null,
        str(p.pool_quantity),
        p.lp_asset ?? null,
      ),
  );
};
const newFairmint: Handler = ({ ev, p, b, bt }, ctx) => {
  {
    if (p.source) ctx.identities.addresses.add(String(p.source));
    if (p.asset) ctx.identities.assets.add(String(p.asset));
    ctx.stmts.push((db) =>
      db
        .prepare(
          `INSERT INTO fairmints
             (event_index,tx_index,tx_hash,block_index,block_time,source_id,fairminter_tx_index,asset_id,
              earn_quantity,paid_quantity,commission,status)
           VALUES (?,?,?,?,?,
             (SELECT address_id FROM address_dictionary WHERE address=?),
             (SELECT tx_index FROM transactions WHERE tx_hash=?),
             (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?)
           ON CONFLICT(event_index) DO UPDATE SET tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,
             block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
             fairminter_tx_index=excluded.fairminter_tx_index,asset_id=excluded.asset_id,
             earn_quantity=excluded.earn_quantity,paid_quantity=excluded.paid_quantity,
             commission=excluded.commission,status=excluded.status`,
        )
        .bind(
          ev.event_index,
          p.tx_index,
          hashToBytes(p.tx_hash),
          b,
          bt,
          p.source ?? null,
          p.fairminter_tx_hash ? hashToBytes(p.fairminter_tx_hash) : null,
          p.asset ?? null,
          str(p.earn_quantity),
          str(p.paid_quantity),
          str(p.commission),
          p.status ?? "valid",
        ),
    );
  }
  if (p.asset && (p.status ?? "valid") === "valid") ctx.supplyDirty.add(p.asset);
};
const fairminterUpdate: Handler = ({ p }, ctx) => {
  if (p.tx_hash) {
    ctx.stmts.push((db) =>
      db
        .prepare(`UPDATE fairminters SET status=coalesce(?,status) WHERE tx_hash=?`)
        .bind(p.status ?? null, hashToBytes(p.tx_hash)),
    );
  }
};
export const fairminters: Record<string, Handler> = {
  NEW_FAIRMINTER: newFairminter,
  NEW_FAIRMINT: newFairmint,
  FAIRMINTER_UPDATE: fairminterUpdate,
};
