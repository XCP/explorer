"use client";
import useSWR from "swr";
import type { AssetHolderMakeup } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { commas } from "@/lib/format";

// "Who holds this?" — composition of the holder base by reputation tier (a real asset skews OG/Established;
// a sybil-minted one skews Casual). Reads /v2/assets/:asset/holder-makeup.
const TIER_COLOR: Record<string, string> = {
  OG: "bg-amber-500", Established: "bg-emerald-500", Active: "bg-sky-500", Casual: "bg-zinc-600", Infra: "bg-zinc-800",
};

export function HolderMakeup({ asset }: { asset: string }) {
  const { data } = useSWR<Envelope<AssetHolderMakeup>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/holder-makeup`));
  const d = data?.result;
  if (!d || !d.holders) return null;
  const tiers = (d.tiers ?? []).filter((t) => t.pct_supply > 0);
  const a = d.archetypes;
  return (
    <Card title="Holder makeup">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400 mb-3">
        <span className="text-zinc-300">{commas(d.holders)} holders</span>
        {d.top_holder_pct != null && <span>top holder {d.top_holder_pct}%</span>}
        {a.creators > 0 && <span>{commas(a.creators)} creators</span>}
        {a.collectors > 0 && <span>{commas(a.collectors)} collectors</span>}
        {a.whales > 0 && <span>{commas(a.whales)} whales</span>}
      </div>
      {/* stacked bar by % of supply */}
      <div className="flex h-3 w-full overflow-hidden rounded bg-zinc-900">
        {tiers.map((t) => (
          <div key={t.tier} className={TIER_COLOR[t.tier] || "bg-zinc-700"} style={{ width: `${t.pct_supply}%` }} title={`${t.tier}: ${t.pct_supply}% of supply`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-4 text-xs">
        {tiers.map((t) => (
          <div key={t.tier} className="flex items-center gap-2 min-w-0">
            <span className={`size-2.5 rounded-sm shrink-0 ${TIER_COLOR[t.tier] || "bg-zinc-700"}`} />
            <span className="text-zinc-300">{t.tier}</span>
            <span className="text-zinc-500 truncate">{commas(t.holders)} · {t.pct_supply}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
