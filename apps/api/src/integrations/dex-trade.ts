const TICKER_URL = "https://api.dex-trade.com/v1/public/ticker?pair=XCPBTC";
const TRADES_URL = "https://api.dex-trade.com/v1/public/trades?pair=XCPBTC";
const MAX_MARKET_AGE_SECONDS = 7 * 86_400;

const object = (value: unknown, message: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
};

export function parseDexTradeXcpBtc(tickerValue: unknown, tradesValue: unknown, now: number): number {
  const ticker = object(tickerValue, "Dex-Trade ticker response must be an object");
  const data = object(ticker.data, "Dex-Trade ticker data must be an object");
  const rate = Number(data.last);
  if (ticker.status !== true || !Number.isFinite(rate) || rate <= 0) throw new Error("Dex-Trade XCP/BTC ticker is invalid");

  const trades = object(tradesValue, "Dex-Trade trades response must be an object");
  if (trades.status !== true || !Array.isArray(trades.data)) throw new Error("Dex-Trade trades data is invalid");
  const latest = Math.max(
    0,
    ...trades.data.map((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return 0;
      const timestamp = Number((value as Record<string, unknown>).timestamp);
      return Number.isFinite(timestamp) ? timestamp : 0;
    }),
  );
  if (!latest || latest > now + 300 || now - latest > MAX_MARKET_AGE_SECONDS) {
    throw new Error("Dex-Trade XCP/BTC market is stale");
  }
  return rate;
}

export async function fetchDexTradeXcpBtc(fetcher: typeof fetch = fetch): Promise<number> {
  const init = {
    headers: { "user-agent": "xcp.io-indexer", accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  };
  const [ticker, trades] = await Promise.all([fetcher(TICKER_URL, init), fetcher(TRADES_URL, init)]);
  if (!ticker.ok || !trades.ok) throw new Error(`Dex-Trade XCP/BTC request failed: ${ticker.status}/${trades.status}`);
  return parseDexTradeXcpBtc(await ticker.json(), await trades.json(), Math.floor(Date.now() / 1_000));
}
