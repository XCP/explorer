/** Fairminters (fair-launch mints): NEW_FAIRMINTER defines the campaign; NEW_FAIRMINT is one mint (and
 *  Counterparty also emits a real ASSET_ISSUANCE per fairmint, so issuance.ts keeps supply correct — we just enqueue
 *  the asset for recompute); FAIRMINTER_UPDATE flips status. */
import { type Handler, str, cap } from "./context";

const newFairminter: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR REPLACE INTO fairminters (tx_hash,block_index,block_time,source,asset,asset_longname,price,hard_cap,soft_cap,soft_cap_deadline_block,max_mint_per_tx,start_block,end_block,divisible,status,quantity_by_price,premint_quantity,pre_minted,minted_asset_commission_int,max_mint_per_address,burn_payment,lock_description,lock_quantity,description,mime_type,asset_parent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(p.tx_hash, b, bt, p.source ?? null, p.asset ?? null, p.asset_longname ?? null, str(p.price),
         str(p.hard_cap), str(p.soft_cap), p.soft_cap_deadline_block ?? null, str(p.max_mint_per_tx),
         p.start_block ?? null, p.end_block ?? null, p.divisible ? 1 : 0, p.status ?? "open",
         str(p.quantity_by_price), str(p.premint_quantity), p.pre_minted ? 1 : 0, str(p.minted_asset_commission_int),
         str(p.max_mint_per_address), p.burn_payment ? 1 : 0, p.lock_description ? 1 : 0, p.lock_quantity ? 1 : 0,
         cap(p.description), p.mime_type ?? null, p.asset_parent ?? null));
};

const newFairmint: Handler = ({ ev, p, b, bt }, ctx) => {
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR IGNORE INTO fairmints (event_index,tx_hash,block_index,block_time,source,fairminter_tx_hash,asset,earn_quantity,paid_quantity,commission,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(ev.event_index, p.tx_hash ?? null, b, bt, p.source ?? null, p.fairminter_tx_hash ?? null, p.asset ?? null,
         str(p.earn_quantity), str(p.paid_quantity), str(p.commission), p.status ?? "valid"));
  if (p.asset && (p.status ?? "valid") === "valid") ctx.supplyDirty.add(p.asset);
};

const fairminterUpdate: Handler = ({ p }, ctx) => {
  ctx.stmts.push((db) => db.prepare(`UPDATE fairminters SET status=COALESCE(?,status) WHERE tx_hash=?`).bind(p.status ?? null, p.tx_hash));
};

export const fairminters: Record<string, Handler> = {
  NEW_FAIRMINTER: newFairminter, NEW_FAIRMINT: newFairmint, FAIRMINTER_UPDATE: fairminterUpdate,
};
