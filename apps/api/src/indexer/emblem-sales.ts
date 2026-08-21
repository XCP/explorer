/** Canonical persistence for Emblem Vault secondary-market sales. */

export interface EmblemSaleRow {
  transactionHash: string;
  logIndex: number;
  contract: string;
  tokenId: string;
  priceRaw: string;
  tokenAddress: string;
  marketplace: string | null;
  buyer: string | null;
  seller: string | null;
  blockNumber: number | null;
}

/** Store normalized identities and converge mutable provider fields on replay. */
export async function upsertEmblemSales(db: D1Database, rows: EmblemSaleRow[]): Promise<void> {
  if (rows.length === 0) return;
  const addresses = [
    ...new Set(
      rows
        .flatMap((row) => [row.contract, row.tokenAddress, row.buyer, row.seller])
        .filter((value): value is string => value != null),
    ),
  ];
  for (let index = 0; index < addresses.length; index += 80)
    await db.batch(
      addresses
        .slice(index, index + 80)
        .map((address) => db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address)),
    );
  for (let index = 0; index < rows.length; index += 50)
    await db.batch(
      rows.slice(index, index + 50).map((row) =>
        db
          .prepare(
            `INSERT INTO emblem_sales(
         tx_hash,log_index,contract_id,token_id,price_raw,token_address_id,marketplace,
         buyer_id,seller_id,block_number
       ) VALUES(
         ?,?,(SELECT address_id FROM address_dictionary WHERE address=?),?,?,
         (SELECT address_id FROM address_dictionary WHERE address=?),?,
         (SELECT address_id FROM address_dictionary WHERE address=?),
         (SELECT address_id FROM address_dictionary WHERE address=?),?
       )
       ON CONFLICT(tx_hash,log_index,contract_id,token_id) DO UPDATE SET
         price_raw=excluded.price_raw,
         token_address_id=excluded.token_address_id,marketplace=excluded.marketplace,
         buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,block_number=excluded.block_number
       WHERE emblem_sales.price_raw IS NOT excluded.price_raw
         OR emblem_sales.token_address_id IS NOT excluded.token_address_id
         OR emblem_sales.marketplace IS NOT excluded.marketplace
         OR emblem_sales.buyer_id IS NOT excluded.buyer_id
         OR emblem_sales.seller_id IS NOT excluded.seller_id
         OR emblem_sales.block_number IS NOT excluded.block_number`,
          )
          .bind(
            row.transactionHash,
            row.logIndex,
            row.contract,
            row.tokenId,
            row.priceRaw,
            row.tokenAddress,
            row.marketplace,
            row.buyer,
            row.seller,
            row.blockNumber,
          ),
      ),
    );
}
