/** Legacy bets (feed-based wagers). OPEN_BET escrows a wager; *_UPDATE carry only changed fields (apply
 *  remainings / status, never re-INSERT a match — that would wipe it); BET_MATCH_RESOLUTION records the
 *  settlement outcome. Wager escrow + settlement balances flow through CREDIT/DEBIT (balance.ts). */
import { type Handler, str } from "#api/indexer/events/context";
import { hashToBytes, parseMatchId } from "#api/indexer/identities";
function matchId(p: Record<string, unknown>): string {
  return String(p.bet_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`);
}
const openBet: Handler = ({ p, b, bt }, ctx) => {
  for (const address of [p.source, p.feed_address]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO bets
           (tx_index,tx_hash,block_index,block_time,source_id,feed_address_id,bet_type,deadline,wager_quantity,
            wager_remaining,counterwager_quantity,counterwager_remaining,target_value,leverage,expiration,
            expire_index,fee_fraction_int,status)
         VALUES (?,?,?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,feed_address_id=excluded.feed_address_id,
           bet_type=excluded.bet_type,deadline=excluded.deadline,wager_quantity=excluded.wager_quantity,
           wager_remaining=excluded.wager_remaining,counterwager_quantity=excluded.counterwager_quantity,
           counterwager_remaining=excluded.counterwager_remaining,target_value=excluded.target_value,
           leverage=excluded.leverage,expiration=excluded.expiration,expire_index=excluded.expire_index,
           fee_fraction_int=excluded.fee_fraction_int,status=excluded.status`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.feed_address ?? null,
        p.bet_type ?? null,
        p.deadline ?? null,
        str(p.wager_quantity),
        str(p.wager_remaining),
        str(p.counterwager_quantity),
        str(p.counterwager_remaining),
        str(p.target_value),
        p.leverage ?? null,
        p.expiration ?? null,
        p.expire_index ?? null,
        str(p.fee_fraction_int),
        p.status ?? "open",
      ),
  );
};
const betUpdate: Handler = ({ p }, ctx) => {
  const hash = p.tx_hash ?? p.bet_hash;
  if (hash) {
    ctx.stmts.push((db) =>
      db
        .prepare(
          `UPDATE bets SET status=coalesce(?,status),wager_remaining=coalesce(?,wager_remaining),
             counterwager_remaining=coalesce(?,counterwager_remaining) WHERE tx_hash=?`,
        )
        .bind(
          p.status ?? null,
          p.wager_remaining != null ? String(p.wager_remaining) : null,
          p.counterwager_remaining != null ? String(p.counterwager_remaining) : null,
          hashToBytes(hash),
        ),
    );
  }
};
const betExpire: Handler = ({ p }, ctx) => {
  const hash = p.tx_hash ?? p.bet_hash;
  if (hash) {
    ctx.stmts.push((db) => db.prepare(`UPDATE bets SET status='expired' WHERE tx_hash=?`).bind(hashToBytes(hash)));
  }
};
const betMatch: Handler = ({ p, b, bt }, ctx) => {
  for (const address of [p.tx0_address, p.tx1_address, p.feed_address]) {
    if (address) ctx.identities.addresses.add(String(address));
  }
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO bet_matches
           (tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,tx1_address_id,feed_address_id,
            forward_quantity,backward_quantity,deadline,target_value,leverage,initial_value,block_index,block_time,
            status,tx0_bet_type,tx1_bet_type,fee_fraction_int,match_expire_index)
         VALUES (
           (SELECT tx_index FROM transactions WHERE tx_hash=?),
           (SELECT tx_index FROM transactions WHERE tx_hash=?),?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx0_index,tx1_index) DO UPDATE SET tx0_hash=excluded.tx0_hash,tx1_hash=excluded.tx1_hash,
           tx0_address_id=excluded.tx0_address_id,tx1_address_id=excluded.tx1_address_id,
           feed_address_id=excluded.feed_address_id,forward_quantity=excluded.forward_quantity,
           backward_quantity=excluded.backward_quantity,deadline=excluded.deadline,target_value=excluded.target_value,
           leverage=excluded.leverage,initial_value=excluded.initial_value,block_index=excluded.block_index,
           block_time=excluded.block_time,status=excluded.status,tx0_bet_type=excluded.tx0_bet_type,
           tx1_bet_type=excluded.tx1_bet_type,fee_fraction_int=excluded.fee_fraction_int,
           match_expire_index=excluded.match_expire_index`,
      )
      .bind(
        hashToBytes(p.tx0_hash),
        hashToBytes(p.tx1_hash),
        hashToBytes(p.tx0_hash),
        hashToBytes(p.tx1_hash),
        p.tx0_address ?? null,
        p.tx1_address ?? null,
        p.feed_address ?? null,
        str(p.forward_quantity),
        str(p.backward_quantity),
        p.deadline ?? null,
        str(p.target_value),
        p.leverage ?? null,
        str(p.initial_value),
        b,
        bt,
        p.status ?? "pending",
        p.tx0_bet_type ?? null,
        p.tx1_bet_type ?? null,
        str(p.fee_fraction_int),
        p.match_expire_index ?? null,
      ),
  );
};
const betMatchUpdate: Handler = ({ p }, ctx) => {
  {
    const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
    ctx.stmts.push((db) =>
      db
        .prepare(
          `UPDATE bet_matches SET status=?
           WHERE tx0_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)
             AND tx1_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)`,
        )
        .bind(p.status ?? "pending", tx0Hash, tx1Hash),
    );
  }
};
const betMatchExpire: Handler = ({ p }, ctx) => {
  {
    const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
    ctx.stmts.push((db) =>
      db
        .prepare(
          `UPDATE bet_matches SET status='expired'
           WHERE tx0_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)
             AND tx1_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)`,
        )
        .bind(tx0Hash, tx1Hash),
    );
  }
};
const betMatchResolution: Handler = ({ ev, p, b, bt }, ctx) => {
  if (p.winner) ctx.identities.addresses.add(String(p.winner));
  const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO bet_match_resolutions
           (event_index,tx_hash,block_index,block_time,bet_match_tx0_index,bet_match_tx1_index,
            bet_match_type_id,winner_id,settled,bull_credit,bear_credit,escrow_less_fee,fee,status)
         VALUES (?,?,?,?,
           (SELECT tx_index FROM transactions WHERE tx_hash=?),
           (SELECT tx_index FROM transactions WHERE tx_hash=?),?,
           (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?)
         ON CONFLICT(event_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,bet_match_tx0_index=excluded.bet_match_tx0_index,
           bet_match_tx1_index=excluded.bet_match_tx1_index,bet_match_type_id=excluded.bet_match_type_id,
           winner_id=excluded.winner_id,settled=excluded.settled,bull_credit=excluded.bull_credit,
           bear_credit=excluded.bear_credit,escrow_less_fee=excluded.escrow_less_fee,fee=excluded.fee,
           status=excluded.status`,
      )
      .bind(
        ev.event_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        tx0Hash,
        tx1Hash,
        p.bet_match_type_id ?? null,
        p.winner ?? null,
        p.settled == null ? null : p.settled ? 1 : 0,
        str(p.bull_credit),
        str(p.bear_credit),
        str(p.escrow_less_fee),
        str(p.fee),
        p.status ?? "valid",
      ),
  );
};
export const bets: Record<string, Handler> = {
  OPEN_BET: openBet,
  BET_UPDATE: betUpdate,
  BET_EXPIRATION: betExpire,
  BET_MATCH: betMatch,
  BET_MATCH_UPDATE: betMatchUpdate,
  BET_MATCH_EXPIRATION: betMatchExpire,
  BET_MATCH_RESOLUTION: betMatchResolution,
};
