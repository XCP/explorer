const CURATED_URL = "https://v2.emblemvault.io/curated";
const REQUEST_TIMEOUT_MS = 15_000;

export interface EmblemCuratedCollection {
  nativeAssets?: string[];
  collectionChain?: string;
  addressChain?: string;
  contracts?: Record<string, string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEmblemCuratedCollections(value: unknown): EmblemCuratedCollection[] {
  if (!Array.isArray(value)) throw new Error("Emblem curated response must be an array");
  return value.map((collection, index) => {
    if (!isObject(collection)) throw new Error(`Emblem curated collection ${index} must be an object`);
    if (
      collection.nativeAssets !== undefined &&
      (!Array.isArray(collection.nativeAssets) || !collection.nativeAssets.every((asset) => typeof asset === "string"))
    ) {
      throw new Error(`Emblem curated collection ${index} nativeAssets must be a string array`);
    }
    for (const field of ["collectionChain", "addressChain"] as const) {
      if (collection[field] !== undefined && typeof collection[field] !== "string") {
        throw new Error(`Emblem curated collection ${index} ${field} must be a string`);
      }
    }
    if (collection.contracts !== undefined) {
      if (
        !isObject(collection.contracts) ||
        !Object.values(collection.contracts).every((address) => typeof address === "string")
      ) {
        throw new Error(`Emblem curated collection ${index} contracts must contain strings`);
      }
    }
    return collection as EmblemCuratedCollection;
  });
}

export async function fetchEmblemCuratedCollections(): Promise<EmblemCuratedCollection[]> {
  const response = await fetch(CURATED_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Emblem curated request failed: ${response.status}`);
  return parseEmblemCuratedCollections(await response.json());
}
