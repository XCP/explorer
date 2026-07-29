/** ASSET_DIVIDEND — pays holders of `asset` a per-unit amount of `dividend_asset`. Per-holder credits +
 *  the source debit + the XCP fee all emit CREDIT/DEBIT (balance.ts); the fee is also part of deterministic
 *  XCP supply. Here we record the dividend declaration. */
import { type Handler, assetDivisible, str } from "#api/indexer/events/context";
import { normalize } from "#api/indexer/codec";
import { hashToBytes } from "#api/indexer/identities";
const dividend: Handler = ({ p, b, bt }, ctx) => {
  if (p.source) ctx.identities.addresses.add(String(p.source));
  for (const asset of [p.asset, p.dividend_asset]) {
    if (asset) ctx.identities.assets.add(String(asset));
  }
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO dividends
           (tx_index,tx_hash,block_index,block_time,source_id,asset_id,dividend_asset_id,
            quantity_per_unit,quantity_per_unit_normalized,fee_paid,status)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,asset_id=excluded.asset_id,
           dividend_asset_id=excluded.dividend_asset_id,quantity_per_unit=excluded.quantity_per_unit,
           quantity_per_unit_normalized=excluded.quantity_per_unit_normalized,
           fee_paid=excluded.fee_paid,status=excluded.status`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.asset ?? null,
        p.dividend_asset ?? null,
        str(p.quantity_per_unit),
        // per-unit is denominated in the PAID asset, so it normalizes by dividend_asset's divisibility
        p.quantity_per_unit_normalized ?? normalize(p.quantity_per_unit, assetDivisible(ctx, p.dividend_asset)),
        str(p.fee_paid),
        p.status ?? "valid",
      ),
  );
};
export const dividends: Record<string, Handler> = { ASSET_DIVIDEND: dividend };
