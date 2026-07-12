"use client";
import useSWR from "swr";
import type { RecordKind } from "@xcp/shared/records";
import type { AssetIndexRow } from "@xcp/shared/assets";
import type { BlockRow } from "@xcp/shared/chain";
import type { MempoolActionRow } from "@xcp/shared/mempool";
import type { SyncOverview } from "@xcp/shared/stats";
import type { TradeRow, TradeVenueStats } from "@xcp/shared/trades";
import type { TagStatsRow, TagDetail } from "@xcp/shared/tags";
import { apiUrl, type Envelope } from "@/lib/api/url";

// Generic list/detail hooks over the explorer read API. Pagination via offset.
function useList<T = unknown>(path: string, params?: Record<string, string | number | undefined>) {
  const { data, error, isLoading } = useSWR<Envelope<T[]>>(apiUrl(path, params));
  return { rows: data?.result ?? [], nextOffset: data?.next_offset, error, isLoading };
}
// The home summary + footer heartbeat both read this; poll every 60s so the tip height stays current.
export const useStats = () => {
  const { data, error, isLoading } = useSWR<Envelope<SyncOverview>>(apiUrl("/v2/status"), { refreshInterval: 60_000 });
  return { item: data?.result, error, isLoading };
};
// Distinct pending-tx count for the footer heartbeat — the same /v2/mempool feed as useMempool, but
// polled at a lazier 60s (the heartbeat is a trust signal, not the live "now" view).
export function useMempoolCount() {
  const { data } = useSWR<Envelope<MempoolActionRow[]>>(apiUrl("/v2/mempool"), { refreshInterval: 60_000 });
  const rows = data?.result ?? [];
  return new Set(rows.map((r) => r.tx_hash)).size;
}
// Mempool hooks poll every 10s (the "now" view). Protocol-wide, plus per-entity feeds that render nothing
// when the entity has no pending actions. A null/undefined entity disables the fetch (SWR skips a null key).
export function useMempool() {
  const { data } = useSWR<Envelope<MempoolActionRow[]>>(apiUrl("/v2/mempool"), { refreshInterval: 10_000 });
  return { rows: data?.result ?? [] };
}
export function useAddressMempool(address?: string) {
  const { data } = useSWR<Envelope<MempoolActionRow[]>>(
    address ? apiUrl(`/v2/addresses/${encodeURIComponent(address)}/mempool`) : null,
    { refreshInterval: 10_000 },
  );
  return { rows: data?.result ?? [] };
}
export function useAssetMempool(asset?: string) {
  const { data } = useSWR<Envelope<MempoolActionRow[]>>(
    asset ? apiUrl(`/v2/assets/${encodeURIComponent(asset)}/mempool`) : null,
    { refreshInterval: 10_000 },
  );
  return { rows: data?.result ?? [] };
}
export const useAssets = (query?: string, offset = 0, limit = 50, sort?: string, dir?: string) =>
  useList<AssetIndexRow>("/v2/assets", { query, offset, limit, sort, dir });
export const useBlocks = (offset = 0, limit = 25) => useList<BlockRow>("/v2/blocks", { offset, limit });
// Generic index hook — one per explorer index page. `name` is the /v2/<name> list endpoint; bind the
// row type per feed (e.g. useIndex<IssuanceRow>("issuances")) to type the rows it returns.
export const useIndex = <T = unknown>(name: RecordKind, offset = 0, limit = 50) =>
  useList<T>(`/v2/${name}`, { offset, limit });

// Unified trades ledger (typed end-to-end — the reference idiom for new hooks).
export const useTrades = (filter: { venue?: string; currency?: string; asset?: string } = {}, offset = 0, limit = 50) =>
  useList<TradeRow>("/v2/trades", { ...filter, offset, limit });
export function useTradeStats() {
  const { data } = useSWR<Envelope<TradeVenueStats[]>>(apiUrl("/v2/trades/stats"));
  return { venues: data?.result ?? [] };
}

// Tag scores — the population aggregate (the /collections scoreboard) + a single tag's aggregate + members.
export function useTags() {
  const { data, error, isLoading } = useSWR<Envelope<TagStatsRow[]>>(apiUrl("/v2/tags"));
  return { rows: data?.result ?? [], error, isLoading };
}
export function useTag(tag: string, offset = 0, limit = 50) {
  const { data, error, isLoading } = useSWR<Envelope<TagDetail>>(
    apiUrl(`/v2/tags/${encodeURIComponent(tag)}`, { offset, limit }),
  );
  return { detail: data?.result, nextOffset: data?.next_offset, error, isLoading };
}
