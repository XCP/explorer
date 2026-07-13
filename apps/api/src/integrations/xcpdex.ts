export interface XcpDexMarket {
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number | null;
  lastTradeAt: number | null;
  lastSide: "buy" | "sell" | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
  volume24h: number | null;
  volume7d: number | null;
  volume30d: number | null;
  trades24h: number;
  trades7d: number;
  trades30d: number;
  openOrders: number;
  bestBid: number | null;
  bestAsk: number | null;
  updatedAt: number;
}

interface XcpDexProviderMarket extends XcpDexMarket {
  baseVolume24h: number | null;
  baseVolume7d: number | null;
  baseVolume30d: number | null;
}

export class XcpDexRequestError extends Error {
  constructor(readonly status: number) {
    super(`XCP DEX market request failed (${status})`);
  }
}

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("XCP DEX market response must be an object");
  }
  return value as Record<string, unknown>;
};

const string = (row: Record<string, unknown>, key: string): string => {
  if (typeof row[key] !== "string" || row[key] === "") throw new Error(`XCP DEX market has invalid ${key}`);
  return row[key];
};

const number = (row: Record<string, unknown>, key: string, nullable = true): number | null => {
  const value = row[key];
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`XCP DEX market has invalid ${key}`);
  return value;
};

const integer = (row: Record<string, unknown>, key: string): number => {
  const value = number(row, key, false);
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`XCP DEX market has invalid ${key}`);
  }
  return value;
};

/** Validate only the provider fields our public contract consumes, then map them to project naming. */
export function parseXcpDexMarket(value: unknown): XcpDexProviderMarket {
  const row = object(value);
  const side = row.last_side;
  if (side !== null && side !== "buy" && side !== "sell") throw new Error("XCP DEX market has invalid last_side");
  return {
    baseAsset: string(row, "base_asset"),
    quoteAsset: string(row, "quote_asset"),
    lastPrice: number(row, "last_price"),
    lastTradeAt: number(row, "last_trade_time"),
    lastSide: side,
    priceChange24h: number(row, "price_change_24h"),
    priceChange7d: number(row, "price_change_7d"),
    priceChange30d: number(row, "price_change_30d"),
    volume24h: number(row, "volume_24h"),
    volume7d: number(row, "volume_7d"),
    volume30d: number(row, "volume_30d"),
    baseVolume24h: number(row, "base_volume_24h"),
    baseVolume7d: number(row, "base_volume_7d"),
    baseVolume30d: number(row, "base_volume_30d"),
    trades24h: integer(row, "trade_count_24h"),
    trades7d: integer(row, "trade_count_7d"),
    trades30d: integer(row, "trade_count_30d"),
    openOrders: integer(row, "open_orders"),
    bestBid: number(row, "best_bid"),
    bestAsk: number(row, "best_ask"),
    updatedAt: integer(row, "updated_at"),
  };
}

async function fetchPair(fetcher: Fetcher, baseAsset: string, quoteAsset: string) {
  const pair = `${encodeURIComponent(baseAsset)}_${encodeURIComponent(quoteAsset)}`;
  const response = await fetcher.fetch(`https://xcpdex-api/pair/${pair}`);
  if (!response.ok) throw new XcpDexRequestError(response.status);
  return parseXcpDexMarket(await response.json());
}

const reciprocal = (value: number | null): number | null => (value && value > 0 ? 1 / value : null);
const inverseChange = (percent: number | null): number | null => {
  if (percent === null || percent <= -100) return null;
  return (-100 * percent) / (100 + percent);
};

const publicMarket = ({ baseVolume24h: _24, baseVolume7d: _7, baseVolume30d: _30, ...market }: XcpDexProviderMarket) =>
  market;

/** Resolve a requested orientation even when xcpdex stores only the opposite orientation of the pair. */
export async function fetchXcpDexMarket(
  fetcher: Fetcher,
  baseAsset: string,
  quoteAsset: string,
): Promise<XcpDexMarket> {
  try {
    return publicMarket(await fetchPair(fetcher, baseAsset, quoteAsset));
  } catch (error) {
    if (!(error instanceof XcpDexRequestError) || error.status !== 404) throw error;
  }

  const reverse = await fetchPair(fetcher, quoteAsset, baseAsset);
  return {
    baseAsset,
    quoteAsset,
    lastPrice: reciprocal(reverse.lastPrice),
    lastTradeAt: reverse.lastTradeAt,
    lastSide: reverse.lastSide === "buy" ? "sell" : reverse.lastSide === "sell" ? "buy" : null,
    priceChange24h: inverseChange(reverse.priceChange24h),
    priceChange7d: inverseChange(reverse.priceChange7d),
    priceChange30d: inverseChange(reverse.priceChange30d),
    volume24h: reverse.baseVolume24h,
    volume7d: reverse.baseVolume7d,
    volume30d: reverse.baseVolume30d,
    trades24h: reverse.trades24h,
    trades7d: reverse.trades7d,
    trades30d: reverse.trades30d,
    openOrders: reverse.openOrders,
    bestBid: reciprocal(reverse.bestAsk),
    bestAsk: reciprocal(reverse.bestBid),
    updatedAt: reverse.updatedAt,
  };
}
