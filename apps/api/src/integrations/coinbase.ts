const COINBASE_PRODUCTS_URL = "https://api.exchange.coinbase.com/products";
const REQUEST_TIMEOUT_MS = 20_000;

export interface CoinbaseCandle {
  time: number;
  close: number;
}

export function parseCoinbaseTicker(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Coinbase ticker response must be an object");
  }
  const price = Number((value as Record<string, unknown>).price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Coinbase ticker has an invalid price");
  return price;
}

export async function fetchCoinbaseSpot(product: string, fetcher: typeof fetch = fetch): Promise<number> {
  const response = await fetcher(`${COINBASE_PRODUCTS_URL}/${encodeURIComponent(product)}/ticker`, {
    headers: { "user-agent": "xcp.io-indexer", accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Coinbase ${product} ticker failed: ${response.status}`);
  return parseCoinbaseTicker(await response.json());
}

export function parseCoinbaseCandles(value: unknown): CoinbaseCandle[] {
  if (!Array.isArray(value)) throw new Error("Coinbase candles response must be an array");

  return value.map((row, index) => {
    if (!Array.isArray(row) || row.length < 5) {
      throw new Error(`Coinbase candle ${index} has an invalid shape`);
    }
    const time = row[0];
    const close = row[4];
    if (typeof time !== "number" || !Number.isFinite(time) || typeof close !== "number" || !Number.isFinite(close)) {
      throw new Error(`Coinbase candle ${index} has invalid numeric fields`);
    }
    return { time, close };
  });
}

export async function fetchCoinbaseCandles(
  product: string,
  start: number,
  end: number,
  granularity: number,
): Promise<CoinbaseCandle[]> {
  const query = new URLSearchParams({
    granularity: String(granularity),
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
  });
  const response = await fetch(`${COINBASE_PRODUCTS_URL}/${encodeURIComponent(product)}/candles?${query}`, {
    headers: { "user-agent": "xcp.io-indexer", accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Coinbase ${product} request failed: ${response.status}`);
  return parseCoinbaseCandles(await response.json());
}
