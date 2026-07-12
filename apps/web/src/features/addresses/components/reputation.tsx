"use client";
import useSWR from "swr";
import {
  ShieldCheck,
  Stamp,
  Wallet,
  Store,
  Building2,
  Coins,
  Crown,
  ArrowDownToLine,
  Flame,
  Sparkles,
  Hammer,
  ArrowLeftRight,
  HandCoins,
  Layers,
  Rocket,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { AddressReputation } from "@xcp/shared/addresses";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { commas } from "@/lib/format";

// Composed address reputation: intrinsic, earned-only (mud/dust-proof), validated predictive.
// Leads with band + tags + EVIDENCE so it's explainable, never a black-box number. New = neutral.
const BAND: Record<string, { color: string; ring: string; bg: string }> = {
  OG: { color: "text-sky-400", ring: "ring-sky-500/30", bg: "bg-sky-500/10" },
  Established: { color: "text-emerald-400", ring: "ring-emerald-500/30", bg: "bg-emerald-500/10" },
  Active: { color: "text-zinc-300", ring: "ring-zinc-600", bg: "bg-zinc-800" },
  Casual: { color: "text-zinc-400", ring: "ring-zinc-700", bg: "bg-zinc-900/60" },
  New: { color: "text-zinc-400", ring: "ring-zinc-700", bg: "bg-zinc-900/60" },
  "No history": { color: "text-zinc-500", ring: "ring-zinc-800", bg: "bg-zinc-900/60" },
  Exchange: { color: "text-violet-300", ring: "ring-violet-500/30", bg: "bg-violet-500/10" },
  "Exchange deposit": { color: "text-zinc-400", ring: "ring-zinc-700", bg: "bg-zinc-900/60" },
};
const TAG_ICON: Record<string, LucideIcon> = {
  OG: Crown,
  "Early Adopter": Sparkles,
  Creator: Stamp,
  "Prolific Creator": Hammer,
  Collector: Wallet,
  Merchant: Store,
  Trader: ArrowLeftRight,
  "Active Trader": ArrowLeftRight,
  "Dividend Payer": HandCoins,
  Exchange: Building2,
  Whale: Coins,
  "Exchange deposit": ArrowDownToLine,
  Burner: Flame,
  "Stamp Creator": Stamp,
  "Stamp Collector": Layers,
  "SRC-20 Deployer": Rocket,
  "BTNS User": Tag,
};
// Persona = the dominant ROLE (what it does). Its own icon + colour so it reads as a headline identity,
// distinct from the reputation band (whether to trust it) below it.
const PERSONA_STYLE: Record<string, { icon: LucideIcon; color: string }> = {
  creator: { icon: Hammer, color: "text-fuchsia-400" },
  collector: { icon: Wallet, color: "text-sky-400" },
  merchant: { icon: Store, color: "text-amber-400" },
  trader: { icon: ArrowLeftRight, color: "text-emerald-400" },
  service: { icon: Building2, color: "text-violet-300" },
  dormant: { icon: Coins, color: "text-zinc-500" },
};

export function ReputationHeader({ address }: { address: string }) {
  const { data, isLoading } = useSWR<Envelope<AddressReputation>>(
    apiUrl(`/v2/addresses/${encodeURIComponent(address)}/reputation`),
  );
  const r = data?.result;
  if (isLoading)
    return (
      <Card>
        <Skeleton rows={2} />
      </Card>
    );
  if (!r) return null;
  const b = BAND[r.band] || BAND.New;
  const ev = r.evidence;
  const lines: [string, string][] = [];
  if (ev) {
    if (ev.survived_assets)
      lines.push([`${commas(ev.survived_assets)} assets found an audience (10+ holders)`, "Creator"]);
    if (ev.assets_hits) lines.push([`${commas(ev.assets_hits)} became hits (50+ holders)`, "Standout"]);
    if (ev.inbound_peers) lines.push([`Credited by ${commas(ev.inbound_peers)} addresses`, "Trust"]);
    if (ev.dispense_btc) lines.push([`${ev.dispense_btc} BTC dispensed`, "Commerce"]);
    if (ev.btc_spent) lines.push([`${ev.btc_spent} BTC spent collecting`, "Economic"]);
    if (ev.dividends) lines.push([`Paid dividends ${commas(ev.dividends)}×`, "Pro-holder"]);
    if (ev.assets_burned) lines.push([`Burned ${commas(ev.assets_burned)} assets`, "Pro-protocol"]);
    if (ev.assets_held) lines.push([`Holds ${commas(ev.assets_held)} distinct assets`, "Collector"]);
    if (ev.xcp) lines.push([`Holds ${commas(ev.xcp)} XCP`, "Pro-protocol"]);
  }
  return (
    <Card>
      <div className="flex items-start gap-4 flex-wrap">
        <div className={`shrink-0 rounded-xl ${b.bg} ring-1 ring-inset ${b.ring} px-5 py-3 text-center min-w-[88px]`}>
          <div className={`text-3xl font-bold tabular-nums ${b.color}`}>{r.score ?? "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">reputation</div>
        </div>
        <div className="flex-1 min-w-0">
          {r.persona &&
            r.persona.primary !== "dormant" &&
            (() => {
              const p = PERSONA_STYLE[r.persona.primary] ?? PERSONA_STYLE.collector;
              const PI = p.icon;
              return (
                <div className="flex items-center gap-2 mb-1" title={r.persona.blurb}>
                  <PI className={`size-4 ${p.color}`} />
                  <span className={`text-lg font-bold leading-none ${p.color}`}>{r.persona.label}</span>
                </div>
              );
            })()}
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck className={`size-4 ${b.color}`} />
            <span className={`font-semibold ${b.color}`}>{r.band}</span>
            {ev?.span_years ? <span className="text-xs text-zinc-400">· active {ev.span_years} yrs</span> : null}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(r.tags || []).map((t: string) => {
              const I = TAG_ICON[t];
              return (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-md bg-zinc-800 text-zinc-200 px-2 py-1 text-xs font-medium ring-1 ring-inset ring-white/5"
                >
                  {I && <I className="size-3" />}
                  {t}
                </span>
              );
            })}
            {(!r.tags || r.tags.length === 0) && <span className="text-xs text-zinc-400">No track record yet</span>}
          </div>
        </div>
      </div>
      {lines.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2">Why · the evidence</div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {lines.map(([txt, label], i) => (
              <div key={i} className="flex items-center justify-between text-sm gap-2">
                <span className="text-zinc-300 truncate">{txt}</span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
