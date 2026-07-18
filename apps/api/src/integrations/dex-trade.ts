const API_ROOT = "https://api.dex-trade.com/v1/public";
const MAX_MARKET_AGE_SECONDS = 7 * 86_400;

export type DexTradePair = "XCPBTC" | "PEPECASHBTC";

export type DexTradeObservation = {
  pair: DexTradePair;
  price: number;
  latestPrice: number;
  latestTime: number;
  latestVolume: number;
};

const object = (value: unknown, message: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
};

export function parseDexTradeMarket(
  pair: DexTradePair,
  tickerValue: unknown,
  tradesValue: unknown,
  now: number,
): DexTradeObservation {
  const ticker = object(tickerValue, "Dex-Trade ticker response must be an object");
  const data = object(ticker.data, "Dex-Trade ticker data must be an object");
  const rate = Number(data.last);
  if (ticker.status !== true || !Number.isFinite(rate) || rate <= 0) throw new Error("Dex-Trade XCP/BTC ticker is invalid");

  const trades = object(tradesValue, "Dex-Trade trades response must be an object");
  if (trades.status !== true || !Array.isArray(trades.data)) throw new Error("Dex-Trade trades data is invalid");
  const rows = trades.data.map((value) => object(value, `Dex-Trade ${pair} trade must be an object`));
  const latest = rows.reduce<Record<string, unknown> | null>((found, row) => {
    const timestamp = Number(row.timestamp);
    if (!Number.isFinite(timestamp)) throw new Error(`Dex-Trade ${pair} trade timestamp is invalid`);
    return !found || timestamp > Number(found.timestamp) ? row : found;
  }, null);
  const latestTime = Number(latest?.timestamp);
  const latestPrice = Number(latest?.rate);
  const latestVolume = Number(latest?.volume);
  if (!latestTime || latestTime > now + 300 || now - latestTime > MAX_MARKET_AGE_SECONDS) {
    throw new Error(`Dex-Trade ${pair} market is stale`);
  }
  if (!Number.isFinite(latestPrice) || latestPrice <= 0 || !Number.isFinite(latestVolume) || latestVolume <= 0) {
    throw new Error(`Dex-Trade ${pair} latest execution is invalid`);
  }
  return { pair, price: rate, latestPrice, latestTime, latestVolume };
}

export async function fetchDexTradeMarket(pair: DexTradePair, fetcher: typeof fetch = fetch): Promise<DexTradeObservation> {
  const init = {
    headers: { "user-agent": "xcp.io-indexer", accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  };
  const [ticker, trades] = await Promise.all([
    fetcher(`${API_ROOT}/ticker?pair=${pair}`, init),
    fetcher(`${API_ROOT}/trades?pair=${pair}`, init),
  ]);
  if (!ticker.ok || !trades.ok) throw new Error(`Dex-Trade ${pair} request failed: ${ticker.status}/${trades.status}`);
  return parseDexTradeMarket(pair, await ticker.json(), await trades.json(), Math.floor(Date.now() / 1_000));
}
