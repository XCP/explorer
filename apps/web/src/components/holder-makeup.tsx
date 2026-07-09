"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { AssetHolderMakeup } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api";
import { commas } from "@/lib/format";

// The four reputation tiers deep-link to their explainer + leaderboard; infra rows (Burn/Exchange/…) don't.
const REPUTATION_TIERS = new Set(["OG", "Established", "Active", "Casual"]);

// "Who holds this?" — composition of the holder base by reputation tier (a real asset skews
// OG/Established; a sybil-minted one skews Casual). Reads /v2/assets/:asset/holder-makeup and
// renders v19's holder-makeup card: quiet .row list, tier label left, value right. Two lenses on the
// SAME tiers, toggled in the header: Supply (each type's % of supply) and Holders (each type's head
// count) — they diverge sharply (PEPECASH Burn is 30.7% of supply but only 10 holders). Owner
// archetype (whale/collector/creator) is a per-holder property — it badges each holders-table row
// (asset-tabs.tsx), not here.
export function HolderMakeup({ asset }: { asset: string }) {
  const { data } = useSWR<Envelope<AssetHolderMakeup>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/holder-makeup`));
  const [view, setView] = useState<"supply" | "holders">("supply");
  const d = data?.result;
  if (!d || !d.holders) return null;
  const rows = view === "holders"
    ? (d.tiers ?? []).filter((t) => t.holders > 0).sort((a, b) => b.holders - a.holders)
    : (d.tiers ?? []).filter((t) => t.pct_supply > 0); // API already sorts by supply share, high→low
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h2 className="mkhead">
        <span>Holder view</span>
        <span className="mktoggle">
          <button className={view === "supply" ? "on" : ""} onClick={() => setView("supply")}>Supply</button>
          <button className={view === "holders" ? "on" : ""} onClick={() => setView("holders")}>Holders</button>
        </span>
      </h2>
      <div className="body">
        {rows.map((t) => (
          <div key={t.tier} className="row">
            <span className="n">
              {REPUTATION_TIERS.has(t.tier)
                ? <Link href={`/reputation/${t.tier.toLowerCase()}`} className="text-inherit hover:text-(--color-accent)">{t.tier}</Link>
                : t.tier}
            </span>
            <span className="amt mono">{view === "holders" ? commas(t.holders) : `${t.pct_supply}%`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
