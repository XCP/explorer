/** Canonical compact-chain reads. Dictionary joins restore the public string identities. */
import type { BlockDetail, BlockRow, BlockTxSummary, TxDetail } from "@xcp/shared/chain";
import { q, one } from "#api/db";

export const BLOCK_PAGE_SQL = `SELECT block_index,LOWER(HEX(block_hash)) block_hash,block_time,transaction_count
FROM blocks ORDER BY block_index DESC LIMIT ?1 OFFSET ?2`;

export const BLOCK_BY_INDEX_SQL = `SELECT block_index,LOWER(HEX(block_hash)) block_hash,block_time,
  LOWER(HEX(previous_block_hash)) previous_block_hash,difficulty,LOWER(HEX(ledger_hash)) ledger_hash,
  LOWER(HEX(txlist_hash)) txlist_hash,LOWER(HEX(messages_hash)) messages_hash,transaction_count
FROM blocks WHERE block_index=?1`;

export const TRANSACTIONS_BY_BLOCK_SQL = `SELECT t.tx_index,LOWER(HEX(t.tx_hash)) tx_hash,
  src.address source,dst.address destination,t.fee
FROM transactions t
LEFT JOIN address_dictionary src ON src.address_id=t.source_id
LEFT JOIN address_dictionary dst ON dst.address_id=t.destination_id
WHERE t.block_index=?1 ORDER BY t.tx_index LIMIT 500`;

export const TRANSACTION_BY_HASH_SQL = `SELECT t.tx_index,LOWER(HEX(t.tx_hash)) tx_hash,t.block_index,t.block_time,
  src.address source,dst.address destination,t.btc_amount,t.fee,NULL data,t.supported,t.utxos_info
FROM transactions t
LEFT JOIN address_dictionary src ON src.address_id=t.source_id
LEFT JOIN address_dictionary dst ON dst.address_id=t.destination_id
WHERE t.tx_hash=unhex(?1)`;

export function listBlocks(db: D1Database, limit: number, offset: number): Promise<BlockRow[]> {
  return q<BlockRow>(db, BLOCK_PAGE_SQL, limit, offset);
}

export function getBlock(db: D1Database, blockIndex: number): Promise<Omit<BlockDetail, "transactions"> | null> {
  return one<Omit<BlockDetail, "transactions">>(db, BLOCK_BY_INDEX_SQL, blockIndex);
}

export function blockTransactions(db: D1Database, blockIndex: number): Promise<BlockTxSummary[]> {
  return q<BlockTxSummary>(db, TRANSACTIONS_BY_BLOCK_SQL, blockIndex);
}

export function getTransaction(db: D1Database, hash: string): Promise<TxDetail | null> {
  return one<TxDetail>(db, TRANSACTION_BY_HASH_SQL, hash);
}

export async function blockTip(db: D1Database): Promise<number> {
  const row = await one<{ block_index: number }>(db, `SELECT block_index FROM blocks ORDER BY block_index DESC LIMIT 1`);
  return Number(row?.block_index) || 0;
}
