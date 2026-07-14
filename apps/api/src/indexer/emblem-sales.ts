/** Compact-native Emblem Vault secondary-market history from Alchemy. */
import type { Env } from "#api/env";
import { fetchAlchemyNftSales } from "#api/integrations/alchemy-sales";
import { getCoreState, getCoreStateInt, getCoreStateStringArray, setCoreState } from "#api/indexer/core-state";

const MAX_PAGES_PER_RUN = 25;

export interface NftSale {
  sellerFee?: { amount?: string; tokenAddress?: string };
  protocolFee?: { amount?: string; tokenAddress?: string };
  royaltyFee?: { amount?: string; tokenAddress?: string };
  transactionHash?: string;
  logIndex?: number;
  tokenId?: string | number;
  marketplace?: string;
  buyerAddress?: string;
  sellerAddress?: string;
  blockNumber?: number;
}

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

/** Sum Alchemy's exact integer fee components without floating-point loss. */
export function priceOf(sale: NftSale): { raw: string; token: string } {
  let amount = 0n;
  for (const fee of [sale.sellerFee, sale.protocolFee, sale.royaltyFee]) {
    try {
      if (fee?.amount) amount += BigInt(fee.amount);
    } catch {
      // One malformed optional fee must not discard an otherwise valid sale.
    }
  }
  const token = (sale.sellerFee?.tokenAddress || sale.protocolFee?.tokenAddress || "ETH").toLowerCase();
  return { raw: amount.toString(), token };
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
       ON CONFLICT(tx_hash,log_index) DO UPDATE SET
         contract_id=excluded.contract_id,token_id=excluded.token_id,price_raw=excluded.price_raw,
         token_address_id=excluded.token_address_id,marketplace=excluded.marketplace,
         buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,block_number=excluded.block_number`,
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

function normalizeSales(contract: string, sales: NftSale[]): EmblemSaleRow[] {
  return sales.flatMap((sale) => {
    if (typeof sale.transactionHash !== "string" || sale.transactionHash === "" || sale.tokenId == null) return [];
    const price = priceOf(sale);
    return [
      {
        transactionHash: sale.transactionHash,
        logIndex: sale.logIndex ?? 0,
        contract,
        tokenId: String(sale.tokenId),
        priceRaw: price.raw,
        tokenAddress: price.token,
        marketplace: sale.marketplace ?? null,
        buyer: sale.buyerAddress ?? null,
        seller: sale.sellerAddress ?? null,
        blockNumber: sale.blockNumber ?? null,
      },
    ];
  });
}

/** Pull a bounded set of pages for the active contract and resume from compact-owned state. */
export async function crawlEmblemSales(env: Env): Promise<Record<string, unknown>> {
  if (!env.ALCHEMY_KEY) return { skipped: "no ALCHEMY_KEY" };
  const contracts = await getCoreStateStringArray(env.CORE_DB, "emblem_contracts");
  if (contracts.length === 0) return { skipped: "no contracts" };
  let contractIndex = await getCoreStateInt(env.CORE_DB, "emblem_sales_idx");
  if (contractIndex < 0 || contractIndex >= contracts.length) contractIndex = 0;
  const contract = contracts[contractIndex];
  let cursor = (await getCoreState(env.CORE_DB, `emblem_sales_cur_${contract}`)) ?? "";
  const out: Record<string, unknown> & { inserted: number; pages: number } = {
    contract,
    inserted: 0,
    pages: 0,
  };
  for (; out.pages < MAX_PAGES_PER_RUN; out.pages++) {
    let page: { nftSales?: NftSale[]; pageKey?: string };
    try {
      page = await fetchAlchemyNftSales(env.ALCHEMY_KEY, contract, cursor);
    } catch (error) {
      out.err = String(error).slice(0, 80);
      break;
    }
    const rows = normalizeSales(contract, page.nftSales ?? []);
    await upsertEmblemSales(env.CORE_DB, rows);
    out.inserted += rows.length;
    // Alchemy can return an empty intermediate page with a valid cursor; only a missing cursor is terminal.
    cursor = page.pageKey ?? "";
    if (!cursor) break;
  }
  await setCoreState(env.CORE_DB, `emblem_sales_cur_${contract}`, cursor);
  if (!cursor) {
    await setCoreState(env.CORE_DB, "emblem_sales_idx", (contractIndex + 1) % contracts.length);
    out.contract_done = true;
  }
  return out;
}
