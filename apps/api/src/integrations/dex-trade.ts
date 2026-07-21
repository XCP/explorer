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
  if (ticker.status !== true || !Number.isFinite(rate) || rate <= 0)
    throw new Error("Dex-Trade XCP/BTC ticker is invalid");

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

/** One daily candle from Dex-Trade's chart endpoint (socket.dex-trade.com/graph/hist).
 *  Prices arrive in SATOSHIS per XCP (the public ticker's `last` is decimal BTC — different scale);
 *  volume arrives in base-asset satoshi units. Conversion to BTC/XCP and XCP happens at import. */
export type DexTradeCandle = {
  time: number; // unix seconds, day-aligned
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function parseDexTradeHistory(value: unknown): DexTradeCandle[] {
  if (!Array.isArray(value)) throw new Error("Dex-Trade history response must be an array");
  const candles = value.map((row, index) => {
    const candle = object(row, `Dex-Trade candle ${index} must be an object`);
    const time = Number(candle.time);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume);
    if (!Number.isInteger(time) || time <= 0) throw new Error(`Dex-Trade candle ${index} time is invalid`);
    for (const [name, price] of [
      ["open", open],
      ["high", high],
      ["low", low],
      ["close", close],
    ] as const) {
      if (!Number.isFinite(price) || price <= 0) throw new Error(`Dex-Trade candle ${index} ${name} is invalid`);
    }
    if (high < low) throw new Error(`Dex-Trade candle ${index} has high below low`);
    if (!Number.isFinite(volume) || volume < 0) throw new Error(`Dex-Trade candle ${index} volume is invalid`);
    return { time, open, high, low, close, volume };
  });
  return candles.sort((a, b) => a.time - b.time);
}

export async function fetchDexTradeHistory(
  pair: DexTradePair,
  end: number,
  limit = 3000,
  fetcher: typeof fetch = fetch,
): Promise<DexTradeCandle[]> {
  const response = await fetcher(`https://socket.dex-trade.com/graph/hist?t=${pair}&r=D&end=${end}&limit=${limit}`, {
    headers: { "user-agent": "xcp.io-indexer", accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Dex-Trade history request failed: ${response.status}`);
  return parseDexTradeHistory(await response.json());
}

export async function fetchDexTradeMarket(
  pair: DexTradePair,
  fetcher: typeof fetch = fetch,
): Promise<DexTradeObservation> {
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
