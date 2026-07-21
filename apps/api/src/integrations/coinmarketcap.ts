/**
 * CoinMarketCap latest-quote client (worker-side) — the free-tier-compatible way to keep the XCP
 * aggregate calendar moving forward. The historical Builder/CSV imports were one-shot (they ended
 * 2026-07-18); /v2/cryptocurrency/quotes/latest costs one credit per call and exists on every plan,
 * so a few polls a day sustain the calendar even after the paid key lapses.
 */
const XCP_CMC_ID = "132"; // Counterparty's permanent CMC UCID (tickers collide; ids don't)

export interface CmcLatestQuote {
  priceUsd: number;
  volume24hUsd: number;
  lastUpdated: string; // ISO timestamp of CMC's own aggregation moment
}

export function parseCmcLatestQuote(payload: unknown): CmcLatestQuote {
  const root = payload as { data?: Record<string, unknown> };
  const entry = root?.data?.[XCP_CMC_ID] as
    { quote?: { USD?: { price?: unknown; volume_24h?: unknown; last_updated?: unknown } } } | undefined;
  const usd = entry?.quote?.USD;
  const price = Number(usd?.price);
  const volume = Number(usd?.volume_24h);
  if (!Number.isFinite(price) || price <= 0) throw new Error("CMC XCP quote price is invalid");
  if (typeof usd?.last_updated !== "string" || !usd.last_updated) throw new Error("CMC XCP quote timestamp is missing");
  return {
    priceUsd: price,
    volume24hUsd: Number.isFinite(volume) && volume >= 0 ? volume : 0,
    lastUpdated: usd.last_updated,
  };
}

export async function fetchCmcXcpLatest(apiKey: string, fetcher: typeof fetch = fetch): Promise<CmcLatestQuote> {
  const response = await fetcher(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${XCP_CMC_ID}`, {
    headers: { accept: "application/json", "X-CMC_PRO_API_KEY": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`CMC quotes/latest failed: ${response.status}`);
  return parseCmcLatestQuote(await response.json());
}
