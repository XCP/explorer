"use client";
import Link from "next/link";
import useSWR from "swr";
import { type ReactNode } from "react";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, Stat, AssetIcon, Skeleton } from "@/components/ui";
import { commas, short } from "@/lib/format";

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

export default function ExchangesPage() {
  const { data } = useSWR<Envelope<any>>(apiUrl("/v2/exchanges"));
  const d = data?.result ?? {};
  const s = d.summary ?? {};
  const ex: any[] = d.exchanges ?? [];
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Exchanges</h1>
        <p className="text-sm text-zinc-500 mt-1">The CEX side of Counterparty history — the custody/deposit wallets of the exchanges that listed XCP-era tokens, and what flowed onto them.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Known exchange wallets" value={commas(s.exchanges)} />
        <Stat label="Deposit addresses" value={commas(s.deposit_addresses)} />
        <Stat label="Operators" value={ex.length ? String(new Set(ex.map((e) => e.name)).size) : "—"} />
      </div>
      <Card title="Exchange wallets">
        {ex.length === 0 ? <Skeleton rows={8} /> : (
          <div className="text-sm">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[10px] uppercase tracking-wider text-zinc-600 pb-1 border-b border-zinc-800">
              <span>Operator / wallet</span><span className="text-right">Assets</span><span className="text-right">Senders</span>
            </div>
            {ex.map((e) => (
              <div key={e.addr} className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center py-1.5 border-b border-zinc-900 last:border-0">
                <span className="flex items-center gap-2 min-w-0"><span className="text-zinc-200">{e.name}</span><Link href={`/address/${e.addr}`} className="font-mono text-xs text-zinc-500 truncate">{short(e.addr)}</Link></span>
                <span className="text-right font-mono text-zinc-400 text-xs">{commas(e.assets_received)}</span>
                <span className="text-right font-mono text-zinc-400 text-xs">{commas(e.in_peers)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Board title="Most-deposited assets (onto exchanges)" rows={d.top_assets ?? []} render={(r) => (
        <><Link href={`/asset/${r.asset}`} className="flex items-center gap-2 flex-1 min-w-0"><AssetIcon asset={r.asset} size={16} /><span className="truncate">{r.asset_longname || r.asset}</span></Link><span className="font-mono text-zinc-400 text-xs shrink-0">{commas(r.depositors)} depositors</span></>
      )} />
    </>
  );
}
