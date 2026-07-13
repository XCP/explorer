// Indexed read plans for the canonical compact schema.
import type { BlockDetail, BlockRow, BlockTxSummary, TxDetail } from "@xcp/shared/chain";
import { one, q } from "#api/db";

export const CORE_SENDS_BY_ADDRESS_SQL = `WITH page AS (
  SELECT * FROM sends WHERE source_id=?1 OR destination_id=?1
  ORDER BY block_index DESC,event_index DESC LIMIT ?2 OFFSET ?3
)
SELECT LOWER(HEX(page.tx_hash)) tx_hash,
       page.block_index,page.block_time,src.address source,dst.address destination,assets.asset,
       page.quantity_normalized,page.send_type,page.status
FROM page
LEFT JOIN address_dictionary src ON src.address_id=page.source_id
LEFT JOIN address_dictionary dst ON dst.address_id=page.destination_id
LEFT JOIN asset_dictionary assets ON assets.asset_id=page.asset_id
ORDER BY page.block_index DESC,page.event_index DESC`;

export const CORE_BALANCES_BY_ADDRESS_SQL = `WITH page AS (
  SELECT asset_id,quantity,quantity_normalized FROM balances
  WHERE address_id=?1 AND CAST(quantity AS INTEGER)>0
  ORDER BY asset_id LIMIT ?2 OFFSET ?3
)
SELECT assets.asset,page.quantity,page.quantity_normalized
FROM page JOIN asset_dictionary assets ON assets.asset_id=page.asset_id
ORDER BY page.asset_id`;

export const CORE_TOTAL_BY_ASSET_SQL = `SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) total
FROM balances WHERE asset_id=?1 AND CAST(quantity AS INTEGER)>0`;

export const ORDER_MATCH_PUBLIC_ID_SQL = `SELECT LOWER(HEX(tx0_hash))||'_'||LOWER(HEX(tx1_hash)) id
FROM order_matches WHERE tx0_index=?1 AND tx1_index=?2`;

export const CORE_BLOCK_PAGE_SQL = `SELECT block_index,LOWER(HEX(block_hash)) block_hash,block_time,transaction_count
FROM blocks ORDER BY block_index DESC LIMIT ?1 OFFSET ?2`;

export const CORE_BLOCK_BY_INDEX_SQL = `SELECT block_index,LOWER(HEX(block_hash)) block_hash,block_time,
  LOWER(HEX(previous_block_hash)) previous_block_hash,difficulty,LOWER(HEX(ledger_hash)) ledger_hash,
  LOWER(HEX(txlist_hash)) txlist_hash,LOWER(HEX(messages_hash)) messages_hash,transaction_count
FROM blocks WHERE block_index=?1`;

export const CORE_TRANSACTIONS_BY_BLOCK_SQL = `SELECT t.tx_index,LOWER(HEX(t.tx_hash)) tx_hash,
  src.address source,dst.address destination,t.fee
FROM transactions t
LEFT JOIN address_dictionary src ON src.address_id=t.source_id
LEFT JOIN address_dictionary dst ON dst.address_id=t.destination_id
WHERE t.block_index=?1 ORDER BY t.tx_index LIMIT 500`;

export const CORE_TRANSACTION_BY_HASH_SQL = `SELECT t.tx_index,LOWER(HEX(t.tx_hash)) tx_hash,t.block_index,t.block_time,
  src.address source,dst.address destination,t.btc_amount,t.fee,NULL data,t.supported,t.utxos_info
FROM transactions t
LEFT JOIN address_dictionary src ON src.address_id=t.source_id
LEFT JOIN address_dictionary dst ON dst.address_id=t.destination_id
WHERE t.tx_hash=unhex(?1)`;

export function listBlocks(db: D1Database, limit: number, offset: number): Promise<BlockRow[]> {
  return q<BlockRow>(db, CORE_BLOCK_PAGE_SQL, limit, offset);
}

export function getBlock(db: D1Database, blockIndex: number): Promise<Omit<BlockDetail, "transactions"> | null> {
  return one<Omit<BlockDetail, "transactions">>(db, CORE_BLOCK_BY_INDEX_SQL, blockIndex);
}

export function blockTransactions(db: D1Database, blockIndex: number): Promise<BlockTxSummary[]> {
  return q<BlockTxSummary>(db, CORE_TRANSACTIONS_BY_BLOCK_SQL, blockIndex);
}

export function getTransaction(db: D1Database, hash: string): Promise<TxDetail | null> {
  return one<TxDetail>(db, CORE_TRANSACTION_BY_HASH_SQL, hash);
}

export async function blockTip(db: D1Database): Promise<number> {
  const row = await one<{ block_index: number }>(
    db,
    `SELECT block_index FROM blocks ORDER BY block_index DESC LIMIT 1`,
  );
  return Number(row?.block_index) || 0;
}
