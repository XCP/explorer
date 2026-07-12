"use client";
import useSWR from "swr";

const REQUEST_TIMEOUT_MS = 8_000;
type PriceQuote = { usd?: number; usd_24h_change?: number };
type PriceResponse = { bitcoin?: PriceQuote; counterparty?: PriceQuote };

function parsePriceResponse(value: unknown): PriceResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid price response");
  const response = value as Record<string, unknown>;
  for (const key of ["bitcoin", "counterparty"] as const) {
    const quote = response[key];
    if (quote === undefined) continue;
    if (typeof quote !== "object" || quote === null || Array.isArray(quote)) throw new Error("Invalid price quote");
    for (const field of ["usd", "usd_24h_change"] as const) {
      const amount = (quote as Record<string, unknown>)[field];
      if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount))) {
        throw new Error("Invalid price amount");
      }
    }
  }
  return value as PriceResponse;
}

// BTC + XCP USD prices for the header tickers (CoinGecko, browser-side, 60s refresh).
export function usePrices() {
  const { data } = useSWR<PriceResponse>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,counterparty&vs_currencies=usd&include_24hr_change=true",
    async (u: string) => {
      const r = await fetch(u, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`Price API ${r.status}`);
      return parsePriceResponse(await r.json());
    },
    { refreshInterval: 60_000, revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  return {
    btc: data?.bitcoin?.usd ?? null,
    btcChange: data?.bitcoin?.usd_24h_change ?? null,
    xcp: data?.counterparty?.usd ?? null,
    xcpChange: data?.counterparty?.usd_24h_change ?? null,
  };
}
