/** The AMM: OPEN_POOL (full insert, keyed by lp_asset), POOL_UPDATE (reserves only, keyed by pair —
 *  the event has no lp_asset), POOL_MATCH (a swap, with fee detail), and NEW_POOL_DEPOSIT/WITHDRAWAL
 *  (liquidity legs; deposit mints LP, withdraw burns it). LP token + reserve balances flow through
 *  CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "./context";

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
};

const update: Handler = ({ p, b }, ctx) => {
  // carries only {asset_a, asset_b, reserve_a, reserve_b}
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE pools SET reserve_a=?, reserve_b=?, updated_block_index=? WHERE asset_a=? AND asset_b=?`)
      .bind(str(p.reserve_a), str(p.reserve_b), b, p.asset_a ?? null, p.asset_b ?? null),
  );
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
};

export const pools: Record<string, Handler> = {
  OPEN_POOL: open,
  POOL_UPDATE: update,
  POOL_MATCH: match,
  NEW_POOL_DEPOSIT: liquidity,
  NEW_POOL_WITHDRAWAL: liquidity,
};
