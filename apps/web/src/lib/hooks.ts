"use client";
import useSWR from "swr";
import type { RecordKind } from "@xcp/shared/records";
import type { AssetDetail, AssetIndexRow } from "@xcp/shared/assets";
import type { BlockDetail, BlockRow, MempoolRow, TxDetail } from "@xcp/shared/chain";
import type { StatsOverview } from "@xcp/shared/stats";
import type { TradeRow, TradeVenueStats } from "@xcp/shared/trades";
import { apiUrl, type Envelope } from "./api";

// Generic list/detail hooks over the explorer read API. Pagination via offset.
function useList<T = unknown>(path: string, params?: Record<string, string | number | undefined>) {
  const { data, error, isLoading } = useSWR<Envelope<T[]>>(apiUrl(path, params));
  return { rows: data?.result ?? [], nextOffset: data?.next_offset, error, isLoading };
}
function useDetail<T>(path: string | null) {
  const { data, error, isLoading } = useSWR<Envelope<T>>(path ? apiUrl(path) : null);
  return { item: data?.result, error, isLoading };
}

export const useStats = () => useDetail<StatsOverview>("/v2/");
// mempool refreshes faster (it's the "now" view)
export function useMempool() {
  const { data } = useSWR<Envelope<MempoolRow[]>>(apiUrl("/v2/mempool"), { refreshInterval: 15_000 });
  return { rows: data?.result ?? [] };
}
export const useAssets = (query?: string, offset = 0, limit = 50) =>
  useList<AssetIndexRow>("/v2/assets", { query, offset, limit });
export const useAsset = (asset?: string) => useDetail<AssetDetail>(asset ? `/v2/assets/${encodeURIComponent(asset)}` : null);
export const useBlocks = (offset = 0, limit = 25) => useList<BlockRow>("/v2/blocks", { offset, limit });
export const useBlock = (n?: string | number) => useDetail<BlockDetail>(n != null ? `/v2/blocks/${n}` : null);
export const useTx = (hash?: string) => useDetail<TxDetail>(hash ? `/v2/transactions/${hash}` : null);
// Generic index hook — one per explorer index page. `name` is the /v2/<name> list endpoint; bind the
// row type per feed (e.g. useIndex<IssuanceRow>("issuances")) to type the rows it returns.
export const useIndex = <T = unknown>(name: RecordKind, offset = 0, limit = 50) => useList<T>(`/v2/${name}`, { offset, limit });

// Unified trades ledger (typed end-to-end — the reference idiom for new hooks).
export const useTrades = (filter: { venue?: string; currency?: string; asset?: string } = {}, offset = 0, limit = 50) =>
  useList<TradeRow>("/v2/trades", { ...filter, offset, limit });
export function useTradeStats() {
  const { data } = useSWR<Envelope<TradeVenueStats[]>>(apiUrl("/v2/trades/stats"));
  return { venues: data?.result ?? [] };
}
