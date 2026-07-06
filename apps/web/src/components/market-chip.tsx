"use client";
import useSWR from "swr";
import type { AssetMarket } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api";
import { commas } from "@/lib/format";

// Live market chip from xcpdex (cross-app composition) — only renders if the asset trades. Client
// island on the (server-rendered) asset page: the price/volume is live, so it stays SWR-backed.
export function MarketChip({ asset }: { asset: string }) {
  // XCP/BTC have no meaningful self-market (priced in XCP); skip the chip for native assets.
  const native = asset === "XCP" || asset === "BTC";
  const { data } = useSWR<Envelope<AssetMarket>>(native ? null : apiUrl(`/v2/assets/${encodeURIComponent(asset)}/market`));
  const m = data?.result;
  if (!m || m.last_price == null) return null;
  const chg = m.price_change_7d;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <span className="text-xs text-zinc-500">Market · xcpdex</span>
      <span className="font-mono text-zinc-100">{m.last_price} <span className="text-zinc-500 text-xs">XCP</span></span>
      {m.volume_7d != null && <span className="font-mono text-xs text-zinc-400">vol {commas(m.volume_7d)} (7d)</span>}
      {chg != null && <span className={`font-mono text-xs ${chg >= 0 ? "text-green-500" : "text-red-500"}`}>{chg >= 0 ? "+" : ""}{Number(chg).toFixed(1)}% 7d</span>}
    </div>
  );
}
