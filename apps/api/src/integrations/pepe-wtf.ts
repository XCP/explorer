const REQUEST_TIMEOUT_MS = 30_000;

export interface PepeWtfAsset {
  name?: string;
  collection?: string;
  serie?: number | null;
  card?: number | null;
  artist?: { name?: string; slug?: string } | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePepeWtfAssets(value: unknown): PepeWtfAsset[] {
  if (!Array.isArray(value)) throw new Error("pepe.wtf assets response must be an array");
  return value.map((asset, index) => {
    if (!isObject(asset)) throw new Error(`pepe.wtf asset ${index} must be an object`);
    for (const field of ["name", "collection"] as const) {
      if (asset[field] !== undefined && typeof asset[field] !== "string") {
        throw new Error(`pepe.wtf asset ${index} ${field} must be a string`);
      }
    }
    for (const field of ["serie", "card"] as const) {
      const number = asset[field];
      if (number !== undefined && number !== null && (typeof number !== "number" || !Number.isFinite(number))) {
        throw new Error(`pepe.wtf asset ${index} ${field} must be a finite number`);
      }
    }
    if (asset.artist !== undefined && asset.artist !== null) {
      if (!isObject(asset.artist)) throw new Error(`pepe.wtf asset ${index} artist must be an object`);
      if (asset.artist.name !== undefined && typeof asset.artist.name !== "string") {
        throw new Error(`pepe.wtf asset ${index} artist name must be a string`);
      }
      if (asset.artist.slug !== undefined && typeof asset.artist.slug !== "string") {
        throw new Error(`pepe.wtf asset ${index} artist slug must be a string`);
      }
    }
    return asset as PepeWtfAsset;
  });
}

export async function fetchPepeWtfAssets(collection: string): Promise<PepeWtfAsset[]> {
  const response = await fetch(`https://api.pepe.wtf/api/asset?collection=${encodeURIComponent(collection)}`, {
    headers: { "user-agent": "xcp.io-indexer" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`pepe.wtf ${collection} request failed: ${response.status}`);
  return parsePepeWtfAssets(await response.json());
}
