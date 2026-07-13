/** Legacy rock-paper-scissors. OPEN_RPS escrows a wager; *_UPDATE carry only changed fields (UPDATE,
 *  never re-INSERT a match). RPS_RESOLVE's status is the resolve TX's own status ("valid"), NOT the match
 *  conclusion (that arrives via RPS_MATCH_UPDATE), so it must not write rps_matches.status. */
import { type Handler, str } from "#api/indexer/events/context";
import { hashToBytes, parseMatchId } from "#api/indexer/compact-codec";

function matchId(p: Record<string, unknown>): string {
  return String(p.rps_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`);
}

const openRps: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO rps (tx_hash,block_index,block_time,source,possible_moves,wager,move_random_hash,expiration,expire_index,status)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(tx_hash) DO UPDATE SET block_index=excluded.block_index,block_time=excluded.block_time,source=excluded.source,possible_moves=excluded.possible_moves,wager=excluded.wager,move_random_hash=excluded.move_random_hash,expiration=excluded.expiration,expire_index=excluded.expire_index,status=excluded.status`,
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
  if (!ctx.compact) return;
  if (p.source) ctx.compact.identities.addresses.add(String(p.source));
  ctx.compact.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO rps
           (tx_index,tx_hash,block_index,block_time,source_id,possible_moves,wager,move_random_hash,expiration,
            expire_index,status)
         VALUES (?,?,?,?,(SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,possible_moves=excluded.possible_moves,
           wager=excluded.wager,move_random_hash=excluded.move_random_hash,expiration=excluded.expiration,
           expire_index=excluded.expire_index,status=excluded.status`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.possible_moves ?? null,
        str(p.wager),
        hashToBytes(p.move_random_hash),
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
  const hash = p.tx_hash ?? p.rps_hash;
  if (ctx.compact && hash) {
    ctx.compact.stmts.push((db) =>
      db
        .prepare(`UPDATE rps SET status=? WHERE tx_hash=?`)
        .bind(ev.event === "RPS_EXPIRATION" ? "expired" : (p.status ?? "updated"), hashToBytes(hash)),
    );
  }
};

const rpsMatch: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO rps_matches (id,tx0_hash,tx0_address,tx1_hash,tx1_address,possible_moves,wager,block_index,block_time,status)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET tx0_hash=excluded.tx0_hash,tx0_address=excluded.tx0_address,tx1_hash=excluded.tx1_hash,tx1_address=excluded.tx1_address,possible_moves=excluded.possible_moves,wager=excluded.wager,block_index=excluded.block_index,block_time=excluded.block_time,status=excluded.status`,
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
  if (!ctx.compact) return;
  for (const address of [p.tx0_address, p.tx1_address]) {
    if (address) ctx.compact.identities.addresses.add(String(address));
  }
  ctx.compact.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO rps_matches
           (tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,tx1_address_id,possible_moves,wager,
            block_index,block_time,status)
         VALUES (
           (SELECT tx_index FROM transactions WHERE tx_hash=?),
           (SELECT tx_index FROM transactions WHERE tx_hash=?),?,?,
           (SELECT address_id FROM address_dictionary WHERE address=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?)
         ON CONFLICT(tx0_index,tx1_index) DO UPDATE SET tx0_hash=excluded.tx0_hash,tx1_hash=excluded.tx1_hash,
           tx0_address_id=excluded.tx0_address_id,tx1_address_id=excluded.tx1_address_id,
           possible_moves=excluded.possible_moves,wager=excluded.wager,block_index=excluded.block_index,
           block_time=excluded.block_time,status=excluded.status`,
      )
      .bind(
        hashToBytes(p.tx0_hash),
        hashToBytes(p.tx1_hash),
        hashToBytes(p.tx0_hash),
        hashToBytes(p.tx1_hash),
        p.tx0_address ?? null,
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
  if (ctx.compact) {
    const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
    ctx.compact.stmts.push((db) =>
      db
        .prepare(
          `UPDATE rps_matches SET status=?
           WHERE tx0_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)
             AND tx1_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)`,
        )
        .bind(p.status ?? "pending", tx0Hash, tx1Hash),
    );
  }
};

const rpsMatchExpire: Handler = ({ p }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(`UPDATE rps_matches SET status='expired' WHERE id=?`)
      .bind(p.rps_match_id ?? p.id ?? `${p.tx0_hash}_${p.tx1_hash}`),
  );
  if (ctx.compact) {
    const { tx0Hash, tx1Hash } = parseMatchId(matchId(p));
    ctx.compact.stmts.push((db) =>
      db
        .prepare(
          `UPDATE rps_matches SET status='expired'
           WHERE tx0_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)
             AND tx1_index=(SELECT tx_index FROM transactions WHERE tx_hash=?)`,
        )
        .bind(tx0Hash, tx1Hash),
    );
  }
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
