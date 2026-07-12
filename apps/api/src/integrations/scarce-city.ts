const REQUEST_TIMEOUT_MS = 12_000;

export interface ScarceCitySale {
  assetName?: string;
  priceInBtc?: string | number;
  timestamp?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScarceCitySales(value: unknown): ScarceCitySale[] {
  if (!Array.isArray(value)) throw new Error("Scarce City sales response must be an array");
  return value.map((sale, index) => {
    if (!isObject(sale)) throw new Error(`Scarce City sale ${index} must be an object`);
    if (sale.assetName !== undefined && typeof sale.assetName !== "string") {
      throw new Error(`Scarce City sale ${index} assetName must be a string`);
    }
    if (sale.priceInBtc !== undefined && typeof sale.priceInBtc !== "string" && typeof sale.priceInBtc !== "number") {
      throw new Error(`Scarce City sale ${index} priceInBtc must be a string or number`);
    }
    if (typeof sale.priceInBtc === "number" && !Number.isFinite(sale.priceInBtc)) {
      throw new Error(`Scarce City sale ${index} priceInBtc must be finite`);
    }
    if (sale.timestamp !== undefined && typeof sale.timestamp !== "string") {
      throw new Error(`Scarce City sale ${index} timestamp must be a string`);
    }
    return sale as ScarceCitySale;
  });
}

export async function fetchScarceCitySales(asset: string): Promise<ScarceCitySale[]> {
  const response = await fetch(`https://scarce.city/api/marketplace/digital/${encodeURIComponent(asset)}/sales`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Scarce City sales request failed: ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) return [];
  return parseScarceCitySales(await response.json());
}
