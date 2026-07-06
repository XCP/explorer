/**
 * Chain queries — the only place that knows the SQL for the chain primitives (blocks, transactions) and
 * the recent-first index feeds. Handlers call these and wrap the result in the envelope; the row shapes
 * are the wire contract (@xcp/shared/chain; the generic feeds pass through their SELECTed columns).
 */
import type { BlockRow, BlockDetail, BlockTxSummary, TxDetail } from "@xcp/shared/chain";
import { q, one } from "../db";

const BLOCK_COLS = `block_index, block_hash, block_time, transaction_count`;

/** Recent blocks, newest first. */
export function listBlocks(db: D1Database, limit: number, offset: number): Promise<BlockRow[]> {
  return q<BlockRow>(db, `SELECT ${BLOCK_COLS} FROM blocks ORDER BY block_index DESC LIMIT ? OFFSET ?`, limit, offset);
}

/** One block's full row — the handler composes the embedded transactions in. */
export function getBlock(db: D1Database, n: number): Promise<Omit<BlockDetail, "transactions"> | null> {
  return one<Omit<BlockDetail, "transactions">>(db, `SELECT * FROM blocks WHERE block_index=?`, n);
}

/** A block's transaction summaries (capped, matching the detail view). */
export function blockTransactions(db: D1Database, n: number): Promise<BlockTxSummary[]> {
  return q<BlockTxSummary>(
    db,
    `SELECT tx_hash, tx_index, source, destination, fee FROM transactions WHERE block_index=? LIMIT 500`,
    n
  );
}

/** One transaction's full row. */
export function getTransaction(db: D1Database, hash: string): Promise<TxDetail | null> {
  return one<TxDetail>(db, `SELECT * FROM transactions WHERE tx_hash=?`, hash);
}

/**
 * Generic recent-first index feed. The per-table SELECT is data-driven (one registered route per record
 * kind), so this wraps the execution behind a single typed query path. `orderCol` lets the orders feed
 * disambiguate its aliased join (o.block_index); every other feed orders on the bare block_index index.
 */
export function listRecords<T = Record<string, unknown>>(
  db: D1Database,
  select: string,
  limit: number,
  offset: number,
  orderCol = "block_index"
): Promise<T[]> {
  return q<T>(db, `${select} ORDER BY ${orderCol} DESC LIMIT ? OFFSET ?`, limit, offset);
}
