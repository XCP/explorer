/** Block headers: NEW_BLOCK (hash/time/difficulty) then BLOCK_PARSED (ledger hashes + tx count). */
import { type Handler, str } from "#api/indexer/events/context";

const newBlock: Handler = ({ p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO blocks (block_index,block_hash,block_time,previous_block_hash,difficulty) VALUES (?,?,?,?,?)
     ON CONFLICT(block_index) DO UPDATE SET block_hash=excluded.block_hash, block_time=excluded.block_time,
       previous_block_hash=excluded.previous_block_hash, difficulty=excluded.difficulty`,
      )
      .bind(b, p.block_hash ?? null, p.block_time ?? bt, p.previous_block_hash ?? null, str(p.difficulty)),
  );
};

const blockParsed: Handler = ({ p, b }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO blocks (block_index,ledger_hash,txlist_hash,messages_hash,transaction_count) VALUES (?,?,?,?,?)
     ON CONFLICT(block_index) DO UPDATE SET ledger_hash=excluded.ledger_hash, txlist_hash=excluded.txlist_hash,
       messages_hash=excluded.messages_hash, transaction_count=excluded.transaction_count`,
      )
      .bind(b, p.ledger_hash ?? null, p.txlist_hash ?? null, p.messages_hash ?? null, p.transaction_count ?? null),
  );
};

export const block: Record<string, Handler> = { NEW_BLOCK: newBlock, BLOCK_PARSED: blockParsed };
