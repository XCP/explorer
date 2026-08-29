// Indexed read plans for the canonical schema.
import type { AttachedBalanceRow, DetachedBalanceRow, AddressSendRow } from "@xcp/shared/addresses";
import { one, q } from "#api/db";

export const CORE_SENDS_BY_ADDRESS_SQL = `WITH candidates AS (
  SELECT * FROM (
    SELECT * FROM sends WHERE source_id=?1
    ORDER BY block_index DESC,event_index DESC LIMIT (?2 + ?3)
  )
  UNION ALL
  SELECT * FROM (
    SELECT * FROM sends
    WHERE destination_id=?1 AND (source_id IS NULL OR source_id<>?1)
    ORDER BY block_index DESC,event_index DESC LIMIT (?2 + ?3)
  )
), page AS (
  SELECT * FROM candidates
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
  SELECT asset_id,quantity,quantity_normalized,updated_block_index FROM balances
  WHERE address_id=?1 AND CAST(quantity AS INTEGER)>0
  ORDER BY asset_id LIMIT ?2 OFFSET ?3
)
SELECT dictionary.asset,page.quantity,page.quantity_normalized,assets.divisible,assets.asset_longname,
       page.updated_block_index,
       EXISTS(
         SELECT 1 FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
          WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset AND tags.tag='stamp'
       ) stamp
FROM page
JOIN asset_dictionary dictionary ON dictionary.asset_id=page.asset_id
LEFT JOIN assets ON assets.asset_id=page.asset_id
ORDER BY page.asset_id`;

export const CORE_UTXO_BALANCES_BY_ADDRESS_SQL = `WITH page AS (
  SELECT utxo_tx_hash,utxo_vout,asset_id,quantity,quantity_normalized,
         updated_block_index,utxo_address_id
  FROM balances INDEXED BY idx_balances_utxo_address
  WHERE utxo_address_id=?1 AND CAST(quantity AS INTEGER)>0
  ORDER BY utxo_tx_hash,utxo_vout,asset_id LIMIT ?2 OFFSET ?3
)
SELECT dictionary.asset,page.quantity,page.quantity_normalized,assets.divisible,assets.asset_longname,
       page.updated_block_index,LOWER(HEX(page.utxo_tx_hash))||':'||page.utxo_vout utxo,
       controller.address utxo_address,
       EXISTS(
         SELECT 1 FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
          WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset AND tags.tag='stamp'
       ) stamp
FROM page
JOIN asset_dictionary dictionary ON dictionary.asset_id=page.asset_id
JOIN address_dictionary controller ON controller.address_id=page.utxo_address_id
LEFT JOIN assets ON assets.asset_id=page.asset_id
ORDER BY page.utxo_tx_hash,page.utxo_vout,page.asset_id`;

export const CORE_TOTAL_BY_ASSET_SQL = `SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) total
FROM balances WHERE asset_id=?1 AND CAST(quantity AS INTEGER)>0`;

export const ORDER_MATCH_PUBLIC_ID_SQL = `SELECT LOWER(HEX(tx0_hash))||'_'||LOWER(HEX(tx1_hash)) id
FROM order_matches WHERE tx0_index=?1 AND tx1_index=?2`;

async function dictionaryId(
  db: D1Database,
  table: "address_dictionary" | "asset_dictionary",
  idColumn: "address_id" | "asset_id",
  valueColumn: "address" | "asset",
  value: string,
): Promise<number | null> {
  const row = await one<{ id: number }>(db, `SELECT ${idColumn} id FROM ${table} WHERE ${valueColumn}=?`, value);
  return row?.id ?? null;
}

export function addressId(db: D1Database, address: string): Promise<number | null> {
  return dictionaryId(db, "address_dictionary", "address_id", "address", address);
}

export function assetId(db: D1Database, asset: string): Promise<number | null> {
  return dictionaryId(db, "asset_dictionary", "asset_id", "asset", asset);
}

export async function listAddressSends(
  db: D1Database,
  address: string,
  limit: number,
  offset: number,
): Promise<AddressSendRow[]> {
  const id = await addressId(db, address);
  return id == null ? [] : q<AddressSendRow>(db, CORE_SENDS_BY_ADDRESS_SQL, id, limit, offset);
}

export async function listAddressBalances(
  db: D1Database,
  address: string,
  limit: number,
  offset: number,
): Promise<DetachedBalanceRow[]> {
  const id = await addressId(db, address);
  return id == null ? [] : q<DetachedBalanceRow>(db, CORE_BALANCES_BY_ADDRESS_SQL, id, limit, offset);
}

export async function listAddressUtxoBalances(
  db: D1Database,
  address: string,
  limit: number,
  offset: number,
): Promise<AttachedBalanceRow[]> {
  const id = await addressId(db, address);
  return id == null ? [] : q<AttachedBalanceRow>(db, CORE_UTXO_BALANCES_BY_ADDRESS_SQL, id, limit, offset);
}

export async function assetBalanceTotal(db: D1Database, asset: string): Promise<string> {
  const id = await assetId(db, asset);
  if (id == null) return "0";
  const row = await one<{ total: string | number }>(db, CORE_TOTAL_BY_ASSET_SQL, id);
  return String(row?.total ?? 0);
}
