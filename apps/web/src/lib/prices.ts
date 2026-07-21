"use client";
import useSWR from "swr";
import type { PriceTicker } from "@xcp/shared/prices";
import { apiUrl, type Envelope } from "@/lib/api/url";

const REQUEST_TIMEOUT_MS = 8_000;

// BTC + XCP for the header tickers — OUR OWN calendar (GET /v2/price/ticker), not a third-party
// aggregator: the number in the header is the same number that values every trade on the site,
// and clicking it lands on /price where its provenance is spelled out.
export function usePrices() {
  const { data } = useSWR<Envelope<PriceTicker>>(
    apiUrl("/v2/price/ticker"),
    async (u: string) => {
      const r = await fetch(u, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`Price API ${r.status}`);
      return (await r.json()) as Envelope<PriceTicker>;
    },
    { refreshInterval: 60_000, revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  return {
    btc: data?.result?.btc?.usd ?? null,
    btcChange: data?.result?.btc?.change_pct ?? null,
    xcp: data?.result?.xcp?.usd ?? null,
    xcpChange: data?.result?.xcp?.change_pct ?? null,
  };
}
