const TOKENSCAN_DIRECTORY_URL = "https://tokenscan.io/js/nfts.js";
const REQUEST_TIMEOUT_MS = 30_000;

export interface TokenscanCollection {
  name: string;
  site?: string;
  cards: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTokenscanDirectoryScript(source: string): TokenscanCollection[] {
  const start = source.indexOf("[");
  const end = source.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Tokenscan NFT_DATA array not found");

  const value: unknown = JSON.parse(source.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error("Tokenscan NFT_DATA must be an array");
  const collections: TokenscanCollection[] = [];
  for (const [index, item] of value.entries()) {
    if (!isObject(item)) throw new Error(`Tokenscan collection ${index} must be an object`);
    if (item.name !== undefined && typeof item.name !== "string") {
      throw new Error(`Tokenscan collection ${index} name must be a string`);
    }
    if (item.site !== undefined && typeof item.site !== "string") {
      throw new Error(`Tokenscan collection ${index} site must be a string`);
    }
    if (
      item.cards !== undefined &&
      (!Array.isArray(item.cards) || !item.cards.every((card) => typeof card === "string"))
    ) {
      throw new Error(`Tokenscan collection ${index} cards must be a string array`);
    }
    if (typeof item.name === "string" && Array.isArray(item.cards) && item.cards.length) {
      collections.push({
        name: item.name,
        ...(typeof item.site === "string" ? { site: item.site } : {}),
        cards: item.cards,
      });
    }
  }
  if (value.length && !collections.length) throw new Error("Tokenscan NFT_DATA contains no usable collections");
  return collections;
}

export async function fetchTokenscanDirectory(): Promise<TokenscanCollection[]> {
  const response = await fetch(TOKENSCAN_DIRECTORY_URL, {
    headers: { "user-agent": "xcp.io-indexer" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Tokenscan directory request failed: ${response.status}`);
  return parseTokenscanDirectoryScript(await response.text());
}
