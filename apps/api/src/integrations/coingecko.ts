const URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,counterparty&vs_currencies=usd";

export interface SpotUsdPrices {
  BTC: number;
  XCP: number;
}

export function parseSpotUsdPrices(value: unknown): SpotUsdPrices {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid spot-price response");
  const row = value as Record<string, unknown>;
  const btc = (row.bitcoin as Record<string, unknown> | undefined)?.usd;
  const xcp = (row.counterparty as Record<string, unknown> | undefined)?.usd;
  if (typeof btc !== "number" || !Number.isFinite(btc) || btc <= 0) throw new Error("invalid BTC/USD spot price");
  if (typeof xcp !== "number" || !Number.isFinite(xcp) || xcp <= 0) throw new Error("invalid XCP/USD spot price");
  return { BTC: btc, XCP: xcp };
}

export async function fetchSpotUsdPrices(fetcher: typeof fetch = fetch): Promise<SpotUsdPrices> {
  const response = await fetcher(URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`CoinGecko spot prices ${response.status}`);
  return parseSpotUsdPrices(await response.json());
}
