"use client";
import useSWR from "swr";
import type { AssetHolderMakeup } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api";

// "Who holds this?" — composition of the holder base by reputation tier (a real asset skews
// OG/Established; a sybil-minted one skews Casual). Reads /v2/assets/:asset/holder-makeup and
// renders v19's holder-makeup card: quiet .row list, tier label left, % of supply right.
export function HolderMakeup({ asset }: { asset: string }) {
  const { data } = useSWR<Envelope<AssetHolderMakeup>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/holder-makeup`));
  const d = data?.result;
  if (!d || !d.holders) return null;
  const tiers = (d.tiers ?? []).filter((t) => t.pct_supply > 0);
  if (tiers.length === 0) return null;
  return (
    <div className="card">
      <h2>Holder makeup</h2>
      <div className="body">
        {tiers.map((t) => (
          <div key={t.tier} className="row">
            <span className="n">{t.tier}</span>
            <span className="amt mono">{t.pct_supply}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
