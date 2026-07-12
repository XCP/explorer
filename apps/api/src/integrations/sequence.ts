const LISTINGS_URL = "https://marketplace-api.sequence.app/mainnet/rpc/Marketplace/ListCollectiblesWithLowestListing";
const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;

export interface SequenceOrder {
  orderId?: string;
  marketplace?: string | number;
  tokenId?: string | null;
  priceUSD?: number;
  priceAmount?: string;
  priceCurrencyAddress?: string;
  validUntil?: string;
}

export interface SequenceCollectibleOrder {
  metadata?: { tokenId?: string };
  order?: SequenceOrder | null;
  listing?: SequenceOrder | null;
}

export interface SequenceListingsPage {
  collectibles?: SequenceCollectibleOrder[];
  page?: { more?: boolean };
  error?: string;
  msg?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalType(value: unknown, type: "string" | "number" | "boolean"): boolean {
  return value === undefined || typeof value === type;
}

function isOrder(value: unknown): value is SequenceOrder {
  if (!isObject(value)) return false;
  return (
    optionalType(value.orderId, "string") &&
    (value.marketplace === undefined ||
      typeof value.marketplace === "string" ||
      typeof value.marketplace === "number") &&
    (value.tokenId === undefined || value.tokenId === null || typeof value.tokenId === "string") &&
    optionalType(value.priceUSD, "number") &&
    (value.priceUSD === undefined || Number.isFinite(value.priceUSD)) &&
    optionalType(value.priceAmount, "string") &&
    optionalType(value.priceCurrencyAddress, "string") &&
    optionalType(value.validUntil, "string")
  );
}

export function parseSequenceListingsPage(value: unknown): SequenceListingsPage {
  if (!isObject(value)) throw new Error("Sequence listings response must be an object");
  if (!optionalType(value.error, "string") || !optionalType(value.msg, "string")) {
    throw new Error("Sequence listings response has invalid error fields");
  }
  if (value.page !== undefined && (!isObject(value.page) || !optionalType(value.page.more, "boolean"))) {
    throw new Error("Sequence listings response has an invalid page");
  }
  if (value.collectibles !== undefined) {
    if (!Array.isArray(value.collectibles)) throw new Error("Sequence collectibles must be an array");
    for (const [index, collectible] of value.collectibles.entries()) {
      if (!isObject(collectible)) throw new Error(`Sequence collectible ${index} must be an object`);
      if (
        collectible.metadata !== undefined &&
        (!isObject(collectible.metadata) || !optionalType(collectible.metadata.tokenId, "string"))
      ) {
        throw new Error(`Sequence collectible ${index} has invalid metadata`);
      }
      for (const field of ["order", "listing"] as const) {
        const order = collectible[field];
        if (order !== undefined && order !== null && !isOrder(order)) {
          throw new Error(`Sequence collectible ${index} has an invalid ${field}`);
        }
      }
    }
  }
  return value as SequenceListingsPage;
}

export async function fetchSequenceListingsPage(
  accessKey: string,
  contract: string,
  page: number,
): Promise<SequenceListingsPage> {
  const response = await fetch(LISTINGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Access-Key": accessKey },
    body: JSON.stringify({
      contractAddress: contract,
      filter: { includeEmpty: false },
      page: { page, pageSize: PAGE_SIZE },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Sequence listings request failed: ${response.status}`);
  return parseSequenceListingsPage(await response.json());
}
