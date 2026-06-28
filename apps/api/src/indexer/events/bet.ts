/** Legacy bets (feed-based wagers). OPEN_BET escrows a wager; *_UPDATE carry only changed fields (apply
 *  remainings / status, never re-INSERT a match — that would wipe it); BET_MATCH_RESOLUTION records the
 *  settlement outcome. Wager escrow + settlement balances flow through CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "./context";

const openBet: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR REPLACE INTO bets (tx_hash,block_index,block_time,source,feed_address,bet_type,deadline,wager_quantity,wager_remaining,counterwager_quantity,counterwager_remaining,target_value,leverage,expiration,expire_index,fee_fraction_int,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(p.tx_hash, b, bt, p.source ?? null, p.feed_address ?? null, p.bet_type ?? null, p.deadline ?? null,
         str(p.wager_quantity), str(p.wager_remaining), str(p.counterwager_quantity), str(p.counterwager_remaining),
         str(p.target_value), p.leverage ?? null, p.expiration ?? null, p.expire_index ?? null, str(p.fee_fraction_int), p.status ?? "open"));
};

const betUpdate: Handler = ({ p }, ctx) => { // carries {wager_remaining, counterwager_remaining, status}
  ctx.stmts.push((db) => db.prepare(
    `UPDATE bets SET status=COALESCE(?,status), wager_remaining=COALESCE(?,wager_remaining), counterwager_remaining=COALESCE(?,counterwager_remaining) WHERE tx_hash=?`
  ).bind(p.status ?? null, p.wager_remaining != null ? String(p.wager_remaining) : null,
         p.counterwager_remaining != null ? String(p.counterwager_remaining) : null, p.tx_hash ?? p.bet_hash));
};

const betExpire: Handler = ({ p }, ctx) => {
  ctx.stmts.push((db) => db.prepare(`UPDATE bets SET status='expired' WHERE tx_hash=?`).bind(p.tx_hash ?? p.bet_hash));
};

const betMatch: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR REPLACE INTO bet_matches (id,tx0_hash,tx0_address,tx1_hash,tx1_address,feed_address,forward_quantity,backward_quantity,deadline,target_value,leverage,initial_value,block_index,block_time,status,tx0_bet_type,tx1_bet_type,fee_fraction_int,match_expire_index)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(p.id ?? `${p.tx0_hash}_${p.tx1_hash}`, p.tx0_hash ?? null, p.tx0_address ?? null, p.tx1_hash ?? null, p.tx1_address ?? null,
         p.feed_address ?? null, str(p.forward_quantity), str(p.backward_quantity), p.deadline ?? null, str(p.target_value),
         p.leverage ?? null, str(p.initial_value), b, bt, p.status ?? "pending",
         p.tx0_bet_type ?? null, p.tx1_bet_type ?? null, str(p.fee_fraction_int), p.match_expire_index ?? null));
};

const betMatchUpdate: Handler = ({ p }, ctx) => { // carries only {id, status}
  ctx.stmts.push((db) => db.prepare(`UPDATE bet_matches SET status=? WHERE id=?`)
    .bind(p.status ?? "pending", p.id ?? p.bet_match_id ?? `${p.tx0_hash}_${p.tx1_hash}`));
};

const betMatchExpire: Handler = ({ p }, ctx) => {
  ctx.stmts.push((db) => db.prepare(`UPDATE bet_matches SET status='expired' WHERE id=?`).bind(p.bet_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`));
};

const betMatchResolution: Handler = ({ ev, p, b, bt }, ctx) => { // who won / settled / dropped
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR IGNORE INTO bet_match_resolutions (event_index,tx_hash,block_index,block_time,bet_match_id,bet_match_type_id,winner,settled,bull_credit,bear_credit,escrow_less_fee,fee,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(ev.event_index, p.tx_hash ?? null, b, bt, p.bet_match_id ?? null, p.bet_match_type_id ?? null,
         p.winner ?? null, p.settled == null ? null : (p.settled ? 1 : 0), str(p.bull_credit), str(p.bear_credit), str(p.escrow_less_fee), str(p.fee), p.status ?? "valid"));
};

export const bets: Record<string, Handler> = {
  OPEN_BET: openBet, BET_UPDATE: betUpdate, BET_EXPIRATION: betExpire,
  BET_MATCH: betMatch, BET_MATCH_UPDATE: betMatchUpdate, BET_MATCH_EXPIRATION: betMatchExpire,
  BET_MATCH_RESOLUTION: betMatchResolution,
};
