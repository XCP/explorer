/** Legacy rock-paper-scissors. OPEN_RPS escrows a wager; *_UPDATE carry only changed fields (UPDATE,
 *  never re-INSERT a match). RPS_RESOLVE's status is the resolve TX's own status ("valid"), NOT the match
 *  conclusion (that arrives via RPS_MATCH_UPDATE), so it must not write rps_matches.status. */
import { type Handler, str } from "./context";

const openRps: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO rps (tx_hash,block_index,block_time,source,possible_moves,wager,move_random_hash,expiration,expire_index,status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        p.tx_hash,
        b,
        bt,
        p.source ?? null,
        p.possible_moves ?? null,
        str(p.wager),
        p.move_random_hash ?? null,
        p.expiration ?? null,
        p.expire_index ?? null,
        p.status ?? "open",
      ),
  );
};

const rpsUpdate: Handler = ({ ev, p }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE rps SET status=? WHERE tx_hash=?`)
      .bind(ev.event === "RPS_EXPIRATION" ? "expired" : (p.status ?? "updated"), p.tx_hash ?? p.rps_hash),
  );
};

const rpsMatch: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO rps_matches (id,tx0_hash,tx0_address,tx1_hash,tx1_address,possible_moves,wager,block_index,block_time,status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        p.id ?? `${p.tx0_hash}_${p.tx1_hash}`,
        p.tx0_hash ?? null,
        p.tx0_address ?? null,
        p.tx1_hash ?? null,
        p.tx1_address ?? null,
        p.possible_moves ?? null,
        str(p.wager),
        b,
        bt,
        p.status ?? "pending",
      ),
  );
};

const rpsMatchUpdate: Handler = ({ p }, ctx) => {
  // carries only {id, status} (the match conclusion)
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE rps_matches SET status=? WHERE id=?`)
      .bind(p.status ?? "pending", p.id ?? p.rps_match_id ?? `${p.tx0_hash}_${p.tx1_hash}`),
  );
};

const rpsMatchExpire: Handler = ({ p }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE rps_matches SET status='expired' WHERE id=?`)
      .bind(p.rps_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`),
  );
};

const rpsResolve: Handler = () => {
  /* see note above — intentionally no-op on rps_matches.status */
};

export const rps: Record<string, Handler> = {
  OPEN_RPS: openRps,
  RPS_UPDATE: rpsUpdate,
  RPS_EXPIRATION: rpsUpdate,
  RPS_MATCH: rpsMatch,
  RPS_MATCH_UPDATE: rpsMatchUpdate,
  RPS_MATCH_EXPIRATION: rpsMatchExpire,
  RPS_RESOLVE: rpsResolve,
};
