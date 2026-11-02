/** Historical listing projection retained for recovery tooling; live ingestion is retired. */
const MAP_CHUNK = 90;

export interface Ask {
  tokenId: string;
  orderId: string | null;
  marketplace: string;
  priceUsd: number;
  priceAmount: string | null;
  currency: string;
  expiry: number;
}

export interface ListingRow extends Ask {
  assetId: number | null;
}

/** Reconcile one fully observed contract inside an unpublished generation. */
export async function upsertEmblemListingContract(
  db: D1Database,
  generation: number,
  contract: string,
  rows: ListingRow[],
  observedAt: number,
): Promise<void> {
  const addresses = [...new Set([contract, ...rows.map((row) => row.currency)].filter((value) => value !== ""))];
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
            `INSERT INTO emblem_listings(
         generation,contract_id,token_id,asset_id,order_id,marketplace,price_usd,
         price_amount,currency_id,url,expiry,updated_at
       ) VALUES(
         ?,(SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,
         (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?
       )
       ON CONFLICT(generation,contract_id,token_id) DO UPDATE SET
         asset_id=excluded.asset_id,order_id=excluded.order_id,marketplace=excluded.marketplace,
         price_usd=excluded.price_usd,price_amount=excluded.price_amount,
         currency_id=excluded.currency_id,url=excluded.url,expiry=excluded.expiry,
         updated_at=excluded.updated_at`,
          )
          .bind(
            generation,
            contract,
            row.tokenId,
            row.assetId,
            row.orderId,
            row.marketplace,
            row.priceUsd,
            row.priceAmount,
            row.currency || null,
            `https://opensea.io/assets/ethereum/${contract}/${row.tokenId}`,
            row.expiry,
            observedAt,
          ),
      ),
    );
  // Rows not observed in this complete sweep are genuine delistings. The generation is not public yet.
  await db
    .prepare(
      `DELETE FROM emblem_listings
      WHERE generation=? AND contract_id=(SELECT address_id FROM address_dictionary WHERE address=?)
        AND updated_at<>?`,
    )
    .bind(generation, contract, observedAt)
    .run();
}
