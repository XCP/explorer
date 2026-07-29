export interface AlchemyNftSale {
  sellerFee?: { amount?: string; tokenAddress?: string };
  protocolFee?: { amount?: string; tokenAddress?: string };
  royaltyFee?: { amount?: string; tokenAddress?: string };
  transactionHash: string;
  logIndex: number;
  tokenId: string | number;
  marketplace?: string;
  buyerAddress?: string;
  sellerAddress?: string;
  blockNumber?: number;
}

export interface AlchemyNftSalesPage {
  nftSales: AlchemyNftSale[];
  pageKey?: string | null;
}

export function parseAlchemyNftSalesPage(value: unknown): AlchemyNftSalesPage {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Alchemy sales must be an object");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.nftSales)) throw new Error("Alchemy sales must contain an nftSales array");
  // Alchemy emits pageKey:null on the terminal page (a 2026-07 change from omitting the field);
  // null means "no more pages" exactly like absence, and the crawler's `?? ""` already treats it so.
  if (page.pageKey != null && typeof page.pageKey !== "string")
    throw new Error("Alchemy sales pageKey must be a string");
  for (const [index, sale] of page.nftSales.entries()) {
    if (typeof sale !== "object" || sale === null || Array.isArray(sale))
      throw new Error(`Alchemy sale ${index} must be an object`);
    const row = sale as Record<string, unknown>;
    if (
      typeof row.transactionHash !== "string" ||
      !Number.isSafeInteger(row.logIndex) ||
      (typeof row.tokenId !== "string" && typeof row.tokenId !== "number")
    ) {
      throw new Error(`Alchemy sale ${index} has an invalid identity`);
    }
  }
  return page as unknown as AlchemyNftSalesPage;
}

export async function fetchAlchemyNftSales(
  apiKey: string,
  contract: string,
  pageKey: string,
): Promise<AlchemyNftSalesPage> {
  const query = new URLSearchParams({ contractAddress: contract, order: "asc", limit: "1000" });
  if (pageKey) query.set("pageKey", pageKey);
  const response = await fetch(
    `https://eth-mainnet.g.alchemy.com/nft/v3/${encodeURIComponent(apiKey)}/getNFTSales?${query}`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    },
  );
  if (!response.ok) throw new Error(`Alchemy sales request failed: ${response.status}`);
  return parseAlchemyNftSalesPage(await response.json());
}
