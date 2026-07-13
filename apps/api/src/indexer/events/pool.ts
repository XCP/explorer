/** The AMM: OPEN_POOL (full insert, keyed by lp_asset), POOL_UPDATE (reserves only, keyed by pair —
 *  the event has no lp_asset), POOL_MATCH (a swap, with fee detail), and NEW_POOL_DEPOSIT/WITHDRAWAL
 *  (liquidity legs; deposit mints LP, withdraw burns it). LP token + reserve balances flow through
 *  CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "#api/indexer/events/context";
import { hashToBytes } from "#api/indexer/compact-codec";

const open: Handler = ({ p, b }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO pools (lp_asset,pair,asset_a,asset_b,reserve_a,reserve_b,lp_supply,status,block_index,updated_block_index)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(lp_asset) DO UPDATE SET reserve_a=excluded.reserve_a, reserve_b=excluded.reserve_b,
       lp_supply=excluded.lp_supply, status=excluded.status, updated_block_index=excluded.updated_block_index`,
      )
      .bind(
        p.lp_asset ?? null,
        p.asset_a && p.asset_b ? `${p.asset_a}_${p.asset_b}` : null,
        p.asset_a ?? null,
        p.asset_b ?? null,
        str(p.reserve_a),
        str(p.reserve_b),
        str(p.lp_supply ?? p.total_lp_supply),
        p.status ?? "open",
        b,
        b,
      ),
  );
  if (!ctx.compact) return;
  for (const asset of [p.asset_a, p.asset_b]) {
    if (asset) ctx.compact.identities.assets.add(String(asset));
  }
  ctx.compact.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO pools
           (asset_a_id,asset_b_id,lp_asset,pair,reserve_a,reserve_b,lp_supply,price,status,block_index,
            updated_block_index)
         VALUES (
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,?,?,?)
         ON CONFLICT(asset_a_id,asset_b_id) DO UPDATE SET lp_asset=excluded.lp_asset,pair=excluded.pair,
           reserve_a=excluded.reserve_a,reserve_b=excluded.reserve_b,lp_supply=excluded.lp_supply,
           price=excluded.price,status=excluded.status,block_index=excluded.block_index,
           updated_block_index=excluded.updated_block_index`,
      )
      .bind(
        p.asset_a ?? null,
        p.asset_b ?? null,
        p.lp_asset,
        p.asset_a && p.asset_b ? `${p.asset_a}_${p.asset_b}` : null,
        str(p.reserve_a),
        str(p.reserve_b),
        str(p.lp_supply ?? p.total_lp_supply),
        p.price ?? null,
        p.status ?? "open",
        b,
        b,
      ),
  );
};

const update: Handler = ({ p, b }, ctx) => {
  // carries only {asset_a, asset_b, reserve_a, reserve_b}
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE pools SET reserve_a=?, reserve_b=?, updated_block_index=? WHERE asset_a=? AND asset_b=?`)
      .bind(str(p.reserve_a), str(p.reserve_b), b, p.asset_a ?? null, p.asset_b ?? null),
  );
  if (ctx.compact && p.asset_a && p.asset_b) {
    ctx.compact.identities.assets.add(String(p.asset_a));
    ctx.compact.identities.assets.add(String(p.asset_b));
    ctx.compact.stmts.push((db) =>
      db
        .prepare(
          `UPDATE pools SET reserve_a=?,reserve_b=?,updated_block_index=?
           WHERE asset_a_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
             AND asset_b_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)`,
        )
        .bind(str(p.reserve_a), str(p.reserve_b), b, p.asset_a, p.asset_b),
    );
  }
};

const match: Handler = ({ ev, p, b, bt }, ctx) => {
  // no lp_asset on event; derive pair, capture swap fee
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO pool_matches (event_index,tx_hash,block_index,block_time,source,lp_asset,pair,forward_asset,forward_quantity,backward_asset,backward_quantity,fee_quantity,fee_bps,order_tx_hash,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ev.event_index,
        p.tx_hash ?? null,
        b,
        bt,
        p.source ?? null,
        p.lp_asset ?? null,
        p.asset_a && p.asset_b ? `${p.asset_a}_${p.asset_b}` : null,
        p.forward_asset ?? null,
        str(p.forward_quantity),
        p.backward_asset ?? null,
        str(p.backward_quantity),
        str(p.fee_quantity),
        p.fee_bps ?? null,
        p.order_tx_hash ?? null,
        p.status ?? "valid",
      ),
  );
  if (!ctx.compact) return;
  if (p.source) ctx.compact.identities.addresses.add(String(p.source));
  for (const asset of [p.forward_asset, p.backward_asset]) {
    if (asset) ctx.compact.identities.assets.add(String(asset));
  }
  ctx.compact.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO pool_matches
           (event_index,tx_index,tx_hash,block_index,block_time,source_id,lp_asset,pair,forward_asset_id,
            forward_quantity,backward_asset_id,backward_quantity,fee_quantity,fee_bps,order_tx_index,status)
         VALUES (?,?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),?,?,
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,
           (SELECT tx_index FROM transactions WHERE tx_hash=?),?)
         ON CONFLICT(event_index) DO UPDATE SET tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,
           block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
           lp_asset=excluded.lp_asset,pair=excluded.pair,forward_asset_id=excluded.forward_asset_id,
           forward_quantity=excluded.forward_quantity,backward_asset_id=excluded.backward_asset_id,
           backward_quantity=excluded.backward_quantity,fee_quantity=excluded.fee_quantity,
           fee_bps=excluded.fee_bps,order_tx_index=excluded.order_tx_index,status=excluded.status`,
      )
      .bind(
        ev.event_index,
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.lp_asset ?? null,
        p.asset_a && p.asset_b ? `${p.asset_a}_${p.asset_b}` : null,
        p.forward_asset ?? null,
        str(p.forward_quantity),
        p.backward_asset ?? null,
        str(p.backward_quantity),
        str(p.fee_quantity),
        p.fee_bps ?? null,
        hashToBytes(p.order_tx_hash),
        p.status ?? "valid",
      ),
  );
};

const liquidity: Handler = ({ ev, p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO pool_liquidity (event_index,tx_hash,block_index,block_time,source,kind,asset_a,asset_b,quantity_a,quantity_b,quantity_minted,quantity_destroyed,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ev.event_index,
        p.tx_hash ?? null,
        b,
        bt,
        p.source ?? null,
        ev.event === "NEW_POOL_DEPOSIT" ? "deposit" : "withdrawal",
        p.asset_a ?? null,
        p.asset_b ?? null,
        str(p.quantity_a),
        str(p.quantity_b),
        str(p.quantity_minted),
        str(p.quantity_destroyed),
        p.status ?? "valid",
      ),
  );
  if (!ctx.compact) return;
  if (p.source) ctx.compact.identities.addresses.add(String(p.source));
  for (const asset of [p.asset_a, p.asset_b]) {
    if (asset) ctx.compact.identities.assets.add(String(asset));
  }
  ctx.compact.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO pool_liquidity
           (event_index,tx_index,tx_hash,block_index,block_time,source_id,kind,asset_a_id,asset_b_id,quantity_a,
            quantity_b,quantity_minted,quantity_destroyed,status)
         VALUES (?,?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),?,
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),
           (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?)
         ON CONFLICT(event_index) DO UPDATE SET tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,
           block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
           kind=excluded.kind,asset_a_id=excluded.asset_a_id,asset_b_id=excluded.asset_b_id,
           quantity_a=excluded.quantity_a,quantity_b=excluded.quantity_b,
           quantity_minted=excluded.quantity_minted,quantity_destroyed=excluded.quantity_destroyed,
           status=excluded.status`,
      )
      .bind(
        ev.event_index,
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        ev.event === "NEW_POOL_DEPOSIT" ? "deposit" : "withdrawal",
        p.asset_a ?? null,
        p.asset_b ?? null,
        str(p.quantity_a),
        str(p.quantity_b),
        str(p.quantity_minted),
        str(p.quantity_destroyed),
        p.status ?? "valid",
      ),
  );
};

export const pools: Record<string, Handler> = {
  OPEN_POOL: open,
  POOL_UPDATE: update,
  POOL_MATCH: match,
  NEW_POOL_DEPOSIT: liquidity,
  NEW_POOL_WITHDRAWAL: liquidity,
};
