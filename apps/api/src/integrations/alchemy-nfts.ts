const REQUEST_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 100;

export interface AlchemyContractNft {
  tokenId: string;
  raw?: { metadata?: { addresses?: unknown } };
}

export interface AlchemyContractNftsPage {
  nfts: AlchemyContractNft[];
  pageKey?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAlchemyContractNftsPage(value: unknown): AlchemyContractNftsPage {
  if (!isObject(value)) throw new Error("Alchemy NFT response must be an object");
  if (!Array.isArray(value.nfts)) throw new Error("Alchemy NFT response must contain an nfts array");
  if (value.pageKey !== undefined && typeof value.pageKey !== "string") {
    throw new Error("Alchemy NFT pageKey must be a string");
  }

  const nfts = value.nfts.map((nft, index) => {
    if (!isObject(nft) || typeof nft.tokenId !== "string") {
      throw new Error(`Alchemy NFT ${index} must have a string tokenId`);
    }
    if (nft.raw !== undefined && !isObject(nft.raw)) {
      throw new Error(`Alchemy NFT ${index} raw metadata must be an object`);
    }
    if (isObject(nft.raw) && nft.raw.metadata !== undefined && !isObject(nft.raw.metadata)) {
      throw new Error(`Alchemy NFT ${index} metadata must be an object`);
    }
    return nft as unknown as AlchemyContractNft;
  });
  return { nfts, ...(value.pageKey === undefined ? {} : { pageKey: value.pageKey }) };
}

export async function fetchAlchemyContractNfts(
  apiKey: string,
  contract: string,
  pageKey: string,
): Promise<AlchemyContractNftsPage> {
  const query = new URLSearchParams({
    contractAddress: contract,
    withMetadata: "true",
    limit: String(PAGE_SIZE),
  });
  if (pageKey) query.set("pageKey", pageKey);
  const response = await fetch(
    `https://eth-mainnet.g.alchemy.com/nft/v3/${encodeURIComponent(apiKey)}/getNFTsForContract?${query}`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`Alchemy NFT request failed: ${response.status}`);
  return parseAlchemyContractNftsPage(await response.json());
}
