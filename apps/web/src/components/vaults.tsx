"use client";
import Link from "next/link";
import useSWR from "swr";
import type { VaultsPayload } from "@xcp/shared/emblem";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, Stat } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { AssetIcon } from "@/components/ui/badges";
import { AreaChart } from "@/components/ui/charts";
import { Board } from "@/components/board";
import { commas } from "@/lib/format";

// Emblem Vault overview — vaulting activity + most-vaulted assets, funders, crackers. Client island
// rendered by the thin server page that owns the static metadata.
export function Vaults() {
  const { data } = useSWR<Envelope<VaultsPayload>>(apiUrl("/v2/vaults"));
  const d = data?.result;
  const s = d?.summary;
  const activity = d?.activity;
  const Addr = (a: string) => <Link href={`/address/${a}`} className="font-mono flex-1 min-w-0 break-all">{a}</Link>;
  const Asset = (asset: string, longname?: string | null) => (
    <Link href={`/asset/${asset}`} className="flex items-center gap-2 flex-1 min-w-0"><AssetIcon asset={asset} size={16} /><span className="truncate">{longname || asset}</span></Link>
  );
  const val = (t: string) => <span className="font-mono text-zinc-400 text-xs shrink-0">{t}</span>;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Emblem Vaults</h1>
        <p className="text-sm text-zinc-400 mt-1">Counterparty assets wrapped as Ethereum NFTs — a custody bridge. What gets vaulted, and who funds and cracks them.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Funded vaults" value={commas(s?.funded_vaults)} />
        <Stat label="Assets vaulted" value={commas(s?.assets_vaulted)} />
        <Stat label="Funders" value={commas(s?.funders)} />
        <Stat label="Crackers" value={commas(s?.crackers)} />
      </div>
      <Card title="Vaulting activity (daily, last 90d)">
        {activity ? <AreaChart data={activity} height={180} /> : <Skeleton rows={4} />}
      </Card>
      <div className="grid lg:grid-cols-3 gap-6">
        <Board title="Most-vaulted assets" rows={d?.top_assets ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.vaults)} vaults`)}</>)} />
        <Board title="Top vault funders" rows={d?.top_funders ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.vaults)} funded`)}</>)} />
        <Board title="Top vault crackers" rows={d?.top_crackers ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.vaults)} cracked`)}</>)} />
      </div>
    </>
  );
}
