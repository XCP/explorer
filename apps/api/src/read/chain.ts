/** Chain primitives + the recent-first index feeds (one per explorer index page). */
import { router, J, lim, off, ORDER_SELECT } from "./shared";

export const chain = router();

/* ---------- blocks ---------- */
chain.get("/v2/blocks", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT block_index, block_hash, block_time, transaction_count FROM blocks ORDER BY block_index DESC LIMIT ? OFFSET ?`
  ).bind(lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) }, 15);
});

chain.get("/v2/blocks/:n", async (c) => {
  const n = parseInt(c.req.param("n"), 10);
  const b = await c.env.DB.prepare(`SELECT * FROM blocks WHERE block_index=?`).bind(n).first<any>();
  if (!b) return c.json({ error: "Block not found" }, 404);
  const txs = await c.env.DB.prepare(
    `SELECT tx_hash, tx_index, source, destination, fee FROM transactions WHERE block_index=? LIMIT 500`
  ).bind(n).all();
  return J(c, { result: { ...b, transactions: txs.results } });
});

/* ---------- transactions ---------- */
chain.get("/v2/transactions/:hash", async (c) => {
  const h = c.req.param("hash");
  const t = await c.env.DB.prepare(`SELECT * FROM transactions WHERE tx_hash=?`).bind(h).first<any>();
  if (!t) return c.json({ error: "Transaction not found" }, 404);
  return J(c, { result: t });
});

/* ---------- index lists (recent-first feeds; one per explorer index page) ----------
   Offset pagination only — next_offset is null at the end (a short page), so the UI gets correct
   Prev/Next without an expensive COUNT(*) over millions of rows. */
const listRoute = (path: string, sql: string) =>
  chain.get(path, async (c) => {
    const l = lim(c), o = off(c);
    const rows = await c.env.DB.prepare(`${sql} ORDER BY block_index DESC LIMIT ? OFFSET ?`).bind(l, o).all();
    return J(c, { result: rows.results, next_offset: rows.results.length === l ? o + l : null });
  });
listRoute("/v2/transactions", `SELECT tx_hash,tx_index,block_index,block_time,source,destination,btc_amount,fee,supported FROM transactions`);
listRoute("/v2/sends", `SELECT tx_hash,block_index,block_time,source,destination,asset,quantity_normalized,send_type,status FROM sends`);
listRoute("/v2/issuances", `SELECT tx_hash,block_index,block_time,asset,asset_longname,source,issuer,quantity_normalized,transfer,divisible,locked,description,status FROM issuances`);
listRoute("/v2/dispensers", `SELECT tx_hash,block_index,block_time,source,asset,give_quantity_normalized,give_remaining_normalized,satoshirate,satoshirate_normalized,dispense_count,status FROM dispensers`);
listRoute("/v2/dispenses", `SELECT tx_hash,block_index,block_time,source,destination,asset,dispense_quantity_normalized,dispenser_tx_hash FROM dispenses`);
chain.get("/v2/orders", async (c) => {
  const l = lim(c), o = off(c);
  const rows = await c.env.DB.prepare(`${ORDER_SELECT} ORDER BY o.block_index DESC LIMIT ? OFFSET ?`).bind(l, o).all();
  return J(c, { result: rows.results, next_offset: rows.results.length === l ? o + l : null });
});
listRoute("/v2/order_matches", `SELECT id,block_index,block_time,tx0_hash,tx1_hash,tx0_address,tx1_address,forward_asset,forward_quantity,backward_asset,backward_quantity,status FROM order_matches`);
listRoute("/v2/sweeps", `SELECT tx_hash,block_index,block_time,source,destination,flags,memo,fee_paid,status FROM sweeps`);
listRoute("/v2/broadcasts", `SELECT tx_hash,block_index,block_time,source,timestamp,value,text,locked,mime_type,status FROM broadcasts`);
listRoute("/v2/burns", `SELECT tx_hash,block_index,block_time,source,burned_normalized,earned_normalized,status FROM burns`);
listRoute("/v2/dividends", `SELECT tx_hash,block_index,block_time,source,asset,dividend_asset,quantity_per_unit_normalized,status FROM dividends`);
listRoute("/v2/bets", `SELECT tx_hash,block_index,block_time,source,feed_address,bet_type,deadline,wager_quantity,counterwager_quantity,target_value,leverage,status FROM bets`);
listRoute("/v2/fairminters", `SELECT tx_hash,block_index,block_time,source,asset,asset_longname,price,hard_cap,soft_cap,divisible,earned_quantity,paid_quantity,status FROM fairminters`);
listRoute("/v2/fairmints", `SELECT tx_hash,block_index,block_time,source,fairminter_tx_hash,asset,earn_quantity,paid_quantity,status FROM fairmints`);
listRoute("/v2/destructions", `SELECT tx_hash,block_index,block_time,source,asset,quantity_normalized,tag,status FROM destructions`);
listRoute("/v2/btcpays", `SELECT tx_hash,block_index,block_time,source,destination,order_match_id,btc_amount_normalized,status FROM btcpays`);
listRoute("/v2/pools", `SELECT lp_asset,pair,asset_a,asset_b,reserve_a,reserve_b,lp_supply,price,status,block_index FROM pools`);
listRoute("/v2/bet_matches", `SELECT id,block_index,block_time,tx0_address,tx1_address,feed_address,forward_quantity,backward_quantity,status FROM bet_matches`);
listRoute("/v2/rps", `SELECT tx_hash,block_index,block_time,source,possible_moves,wager,expiration,status FROM rps`);
listRoute("/v2/rps_matches", `SELECT id,block_index,block_time,tx0_address,tx1_address,possible_moves,wager,status FROM rps_matches`);
listRoute("/v2/pool_matches", `SELECT tx_hash,block_index,block_time,source,lp_asset,pair,forward_asset,forward_quantity,backward_asset,backward_quantity FROM pool_matches`);
