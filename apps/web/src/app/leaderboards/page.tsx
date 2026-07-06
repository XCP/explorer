"use client";
import Link from "next/link";
import useSWR from "swr";
import { useState, type ReactNode } from "react";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, AssetIcon, Skeleton } from "@/components/ui";
import { commas } from "@/lib/format";

function Board({ title, rows, render }: { title: string; rows: any[]; render: (r: any) => ReactNode }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? <Skeleton rows={6} /> : (
        <ol className="text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-3 py-1.5 border-b border-zinc-900 last:border-0">
              <span className="w-5 shrink-0 text-right text-zinc-600 font-mono text-xs">{i + 1}</span>
              {render(r)}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default function LeaderboardsPage() {
  const [showLowQ, setShowLowQ] = useState(false);
  const { data } = useSWR<Envelope<any>>(apiUrl("/v2/leaderboards", showLowQ ? { include_hidden: 1 } : {}));
  const d = data?.result ?? {};

  const Addr = (a: string) => <Link href={`/address/${a}`} className="font-mono flex-1 min-w-0 break-all">{a}</Link>;
  const Asset = (asset: string, longname?: string) => (
    <Link href={`/asset/${asset}`} className="flex items-center gap-2 flex-1 min-w-0"><AssetIcon asset={asset} size={16} /><span className="truncate">{longname || asset}</span></Link>
  );
  const val = (t: string) => <span className="font-mono text-zinc-400 text-xs shrink-0">{t}</span>;

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Leaderboards</h1>
          <p className="text-sm text-zinc-500 mt-1">Derived across the whole chain — who builds, who collects, what endures. Reputation signals, not just balances.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer shrink-0 mt-1">
          <input type="checkbox" checked={!showLowQ} onChange={(e) => setShowLowQ(!e.target.checked)} className="accent-[--color-xcp] w-3.5 h-3.5" />
          Hide low quality
        </label>
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mt-2">People</h2>
      <div className="grid lg:grid-cols-3 gap-6">
        <Board title="Top creators" rows={d.top_creators ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.survived_assets)} assets that landed`)}</>)} />
        <Board title="Top collectors" rows={d.top_collectors ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.assets_held)} held`)}</>)} />
        <Board title="Biggest merchants" rows={d.top_merchants ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.dispense_btc)} BTC dispensed`)}</>)} />
        <Board title="Biggest BTC spenders" rows={d.biggest_spenders ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.btc_spent)} BTC`)}</>)} />
        <Board title="Richest — XCP" rows={d.richest_xcp ?? []} render={(r) => (<>{Addr(r.holder)}{val(commas(r.quantity_normalized))}</>)} />
        <Board title="Trusted dispensers" rows={d.top_dispensers ?? []} render={(r) => (<>{Addr(r.addr)}{val(`trust ${r.disp_trust} · ${commas(r.dispenses)} sales`)}</>)} />
        <Board title="Top creator hits" rows={d.top_hits ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.assets_hits)} hits (50+ holders)`)}</>)} />
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mt-4">Assets</h2>
      <div className="grid lg:grid-cols-3 gap-6">
        <Board title="Most held" rows={d.most_held ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.holders)} holders`)}</>)} />
        <Board title="Most traded" rows={d.most_traded ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.trades)} trades`)}</>)} />
        <Board title="Most durable" rows={d.most_durable ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.months_traded)} mo traded`)}</>)} />
        <Board title="Most dispensed (BTC)" rows={d.top_dispensed ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.dispense_btc)} BTC`)}</>)} />
        <Board title="Broadest holder base" rows={d.broadest_holders ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`breadth ${commas(r.holder_breadth)}`)}</>)} />
        <Board title="Most creator-held" rows={d.most_creator_held ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${r.pct_creator_holders}% creators`)}</>)} />
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mt-4">Reputation</h2>
      <div className="grid lg:grid-cols-3 gap-6">
        <Board title="Highest reputation (OG)" rows={d.top_reputation ?? []} render={(r) => (<>{Addr(r.addr)}{val(`score ${r.score}`)}</>)} />
        <Board title="Highest quality (Bluechip)" rows={d.top_quality ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`score ${r.score}`)}</>)} />
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mt-4">Bitcoin Stamps</h2>
      <div className="grid lg:grid-cols-3 gap-6">
        <Board title="Top stamp creators" rows={d.top_stamp_creators ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.stamps_created)} stamps`)}</>)} />
        <Board title="Top stamp collectors" rows={d.top_stamp_collectors ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.stamps_collected)} held`)}</>)} />
        <Board title="Top SRC-20 deployers" rows={d.top_src20_deployers ?? []} render={(r) => (<>{Addr(r.addr)}{val(`${commas(r.src20_deploys)} deploys`)}</>)} />
        <Board title="Most-held stamps" rows={d.most_held_stamps ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.holders)} holders`)}</>)} />
      </div>
    </>
  );
}
