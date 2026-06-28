"use client";
import Link from "next/link";
import useSWR from "swr";
import { GitBranch, Users, Network, ShieldCheck, ShieldAlert, Crown, Flame } from "lucide-react";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, AssetArt, Skeleton, Stat } from "@/components/ui";
import { ad } from "@/lib/indexes";
import { commas } from "@/lib/format";

// "Holders also collect" — the collector-cohort / related-collections graph, rendered as a wall of
// card art. Counterparty is a collectibles chain; the art IS the recommendation.
export function AssetCohort({ asset }: { asset: string }) {
  const { data, isLoading } = useSWR<Envelope<any[]>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/cohort`));
  const rows = data?.result ?? [];
  if (!isLoading && rows.length === 0) return null;
  return (
    <Card title="Holders also collect">
      {isLoading ? <Skeleton rows={2} /> : (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {rows.map((r) => (
            <Link key={r.asset} href={`/asset/${r.asset}`}
              className="group relative overflow-hidden rounded-lg border border-zinc-800 hover:border-[--color-xcp] transition-colors">
              <AssetArt asset={r.asset} stamp={r.stamp} className="w-full aspect-[3/4] group-hover:scale-105 transition-transform" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pt-6 pb-1.5">
                <div className="text-[11px] font-medium text-zinc-100 truncate">{r.asset_longname || r.asset}</div>
                <div className="text-[10px] text-zinc-400 font-mono">{commas(r.shared)} shared</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// Holder quality + trading integrity — aggregate, non-creepy "is this cap table real?" read for an
// asset (fairmint due-diligence). Two independent axes: community strength (connectivity + count +
// concentration) and trading integrity (wash ratio). Intrinsic; no collection/curation input.
export function HolderQuality({ asset }: { asset: string }) {
  const { data, isLoading } = useSWR<Envelope<any>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/quality`));
  const q = data?.result;
  if (!isLoading && (!q || !q.holders)) return null;
  // Community strength: broad-collector holders (un-confounded, fairmint-safe) + enough of them + not over-concentrated.
  const strong = q && q.holders >= 25 && q.holder_breadth >= 20 && q.top1_pct < 80;
  const thin = q && (q.holders < 10 || q.top1_pct >= 90);
  return (
    <Card title="Holder quality">
      {isLoading || !q ? <Skeleton rows={2} /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Holders" value={commas(q.holders)} icon={<Users className="size-3" />} />
            <Stat label="Holder breadth" value={commas(q.holder_breadth)} icon={<Network className="size-3" />} />
            <Stat label="Creator holders" value={`${q.pct_creator_holders}%`} icon={<Crown className="size-3" />} />
            <Stat label="Top holder (circ.)" value={`${q.top1_pct}%`} icon={<Users className="size-3" />} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {q.burned_pct > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/10 text-orange-400 px-2 py-1 ring-1 ring-inset ring-orange-500/20"><Flame className="size-3" />{q.burned_pct}% of supply burned</span>}
            {strong && <span className="inline-flex items-center gap-1 rounded-md bg-green-500/10 text-green-400 px-2 py-1 ring-1 ring-inset ring-green-500/20"><ShieldCheck className="size-3" />Established community · broad collectors</span>}
            {thin && <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 text-amber-400 px-2 py-1 ring-1 ring-inset ring-amber-500/20"><ShieldAlert className="size-3" />Thin / concentrated holder base</span>}
            {q.wash_suspect
              ? <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 text-red-400 px-2 py-1 ring-1 ring-inset ring-red-500/20"><ShieldAlert className="size-3" />Low trading integrity · {q.self_trade_pct}% self-trades</span>
              : q.trades > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-zinc-800 text-zinc-300 px-2 py-1 ring-1 ring-inset ring-white/5"><ShieldCheck className="size-3" />Organic trading · {commas(q.trades)} trades</span>}
          </div>
        </>
      )}
    </Card>
  );
}

// Top counterparties merged across sends + dispenses + DEX trades — the address's on-chain social
// graph, as a ranked list with proportional interaction bars.
export function AddressConnections({ address }: { address: string }) {
  const { data, isLoading } = useSWR<Envelope<any[]>>(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/connections`));
  const rows = data?.result ?? [];
  const max = rows.length ? Number(rows[0].interactions) : 1;
  if (!isLoading && rows.length === 0) return null;
  return (
    <Card title="Connections">
      {isLoading ? <Skeleton rows={3} /> : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.cp} className="relative rounded overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-[--color-xcp]/10" style={{ width: `${Math.max(3, (Number(r.interactions) / max) * 100)}%` }} />
              <div className="relative flex items-center justify-between px-2 py-1.5 text-sm">
                <span className="truncate">{ad(r.cp)}</span>
                <span className="font-mono text-xs text-zinc-400 shrink-0 ml-2">{commas(r.interactions)}×</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Identity lineage via sweeps — a SWEEP moves all assets + ownership to another address, the strongest
// "same person" signal on chain (commonly legacy 1… → segwit bc1q… wallet migrations).
export function AddressLineage({ address }: { address: string }) {
  const { data } = useSWR<Envelope<any[]>>(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/lineage`));
  const rows = data?.result ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-4 py-2.5 text-sm flex items-start gap-2.5">
      <GitBranch className="size-4 text-amber-400 mt-0.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <span className="text-zinc-200 font-medium">Identity lineage <span className="text-zinc-500 font-normal">· linked by sweep (same owner)</span></span>
        {rows.map((r, i) => (
          <span key={i} className="text-zinc-400">
            {r.direction === "out" ? "swept all assets → " : "received sweep ← "}
            {ad(r.counterparty)} <span className="text-zinc-600">· block {commas(r.block_index)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
