"use client";
import useSWR from "swr";

// BTC + XCP USD prices for the header tickers (CoinGecko, browser-side, 60s refresh).
export function usePrices() {
  const { data } = useSWR(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,counterparty&vs_currencies=usd&include_24hr_change=true",
    (u: string) => fetch(u).then((r) => r.json()),
    { refreshInterval: 60_000, revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  return {
    btc: data?.bitcoin?.usd ?? null,
    btcChange: data?.bitcoin?.usd_24h_change ?? null,
    xcp: data?.counterparty?.usd ?? null,
    xcpChange: data?.counterparty?.usd_24h_change ?? null,
  };
}
