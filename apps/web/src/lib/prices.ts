"use client";
import useSWR from "swr";

const REQUEST_TIMEOUT_MS = 8_000;

// BTC + XCP USD prices for the header tickers (CoinGecko, browser-side, 60s refresh).
export function usePrices() {
  const { data } = useSWR(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,counterparty&vs_currencies=usd&include_24hr_change=true",
    async (u: string) => {
      const r = await fetch(u, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`Price API ${r.status}`);
      return r.json();
    },
    { refreshInterval: 60_000, revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  return {
    btc: data?.bitcoin?.usd ?? null,
    btcChange: data?.bitcoin?.usd_24h_change ?? null,
    xcp: data?.counterparty?.usd ?? null,
    xcpChange: data?.counterparty?.usd_24h_change ?? null,
  };
}
