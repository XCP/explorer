"use client";
import Link from "next/link";
import useSWR from "swr";
import { type ReactNode } from "react";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, Stat, AssetIcon, AreaChart, Skeleton } from "@/components/ui";
import { commas } from "@/lib/format";

function Board({ title, rows, render }: { title: string; rows: any[]; render: (r: any) => ReactNode }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? <Skeleton rows={6} /> : (
        <ol className="text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-3 py-1.5 border-b border-zinc-900 last:border-0">
              <span className="w-5 shrink-0 text-right text-zinc-600 font-mono text-xs">{i + 1}</span>{render(r)}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default function VaultsPage() {
  const { data } = useSWR<Envelope<any>>(apiUrl("/v2/vaults"));
  const d = data?.result ?? {};
  const s = d.summary ?? {};
  const Addr = (a: string) => <Link href={`/address/${a}`} className="font-mono flex-1 min-w-0 break-all">{a}</Link>;
  const Asset = (asset: string, longname?: string) => (
    <Link href={`/asset/${asset}`} className="flex items-center gap-2 flex-1 min-w-0"><AssetIcon asset={asset} size={16} /><span className="truncate">{longname || asset}</span></Link>
  );
  const val = (t: string) => <span className="font-mono text-zinc-400 text-xs shrink-0">{t}</span>;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Emblem Vaults</h1>
        <p className="text-sm text-zinc-500 mt-1">Counterparty assets wrapped as Ethereum NFTs — a custody bridge. What gets vaulted, and who funds and cracks them.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Funded vaults" value={commas(s.funded_vaults)} />
        <Stat label="Assets vaulted" value={commas(s.assets_vaulted)} />
        <Stat label="Funders" value={commas(s.funders)} />
        <Stat label="Crackers" value={commas(s.crackers)} />
      </div>
      <Card title="Vaulting activity (daily, last 90d)">
        {d.activity ? <AreaChart data={d.activity} height={180} /> : <Skeleton rows={4} />}
      </Card>
      <div className="grid lg:grid-cols-3 gap-6">
        <Board title="Most-vaulted assets" rows={d.top_assets ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.vaults)} vaults`)}</>)} />
        <Board title="Top vault funders" rows={d.top_funders ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.vaults)} funded`)}</>)} />
        <Board title="Top vault crackers" rows={d.top_crackers ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.vaults)} cracked`)}</>)} />
      </div>
    </>
  );
}
