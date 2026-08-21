const REQUEST_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 100;
const MAX_RETRIES = 4;
const MAX_BACKOFF_MS = 8_000;

const backoffMs = (attempt: number, retryAfter = 0) => {
  const requested = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
  const bounded = Math.min(MAX_BACKOFF_MS, requested);
  // Jitter prevents every scheduled Worker invocation from retrying a recovering provider together.
  return Math.round(bounded * (0.75 + Math.random() * 0.5));
};

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
  // Alchemy meters compute units per second, so crawl loops intermittently see 429 — wait and
  // retry instead of surfacing a one-tick soft failure.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      `https://eth-mainnet.g.alchemy.com/nft/v3/${encodeURIComponent(apiKey)}/getNFTsForContract?${query}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (response.ok) return parseAlchemyContractNftsPage(await response.json());
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, retryAfter)));
      continue;
    }
    throw new Error(`Alchemy NFT request failed: ${response.status}`);
  }
}
