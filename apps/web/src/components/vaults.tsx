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
import { commas, usdCompact } from "@/lib/format";

// Human labels for the per-sale verdict (trades.sale_class). Honest about what each means — especially
// that non_counterparty value lives on another chain and isn't a Counterparty sale at all.
const CLASS_LABEL: Record<string, string> = {
  real: "Real — card sold full",
  bundle: "Bundle (multi-card)",
  scam_empty: "Empty-shell scam",
  scam_cracked: "Cracked then resold",
  non_counterparty: "Other chain (not CP)",
};

// Emblem Vault overview — the honest Counterparty-vs-foreign census + the ETH-side sales market (volume,
// most-sold cards, verdict split). Client island rendered by the thin server page that owns the metadata.
export function Vaults() {
  const { data } = useSWR<Envelope<VaultsPayload>>(apiUrl("/v2/vaults"));
  const d = data?.result;
  const s = d?.summary;
  const Addr = (a: string) => <Link href={`/address/${a}`} className="font-mono flex-1 min-w-0 break-all">{a}</Link>;
  const Asset = (asset: string, longname?: string | null) => (
    <Link href={`/asset/${asset}`} className="flex items-center gap-2 flex-1 min-w-0"><AssetIcon asset={asset} size={16} /><span className="truncate">{longname || asset}</span></Link>
  );
  const val = (t: string) => <span className="font-mono text-zinc-400 text-xs shrink-0">{t}</span>;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Emblem Vaults</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Bitcoin assets wrapped as Ethereum NFTs. Emblem is multi-chain — we track the{" "}
          <span className="text-zinc-300">Counterparty</span> vaults and their ETH-side sales market. Foreign
          vaults (Namecoin, Ordinals, BTC) hold value on other chains and aren&rsquo;t counted as Counterparty.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Counterparty vaults" value={commas(s?.counterparty_vaults)} />
        <Stat label="Foreign vaults" value={commas(s?.foreign_vaults)} />
        <Stat label="Funded now" value={commas(s?.funded_vaults)} />
        <Stat label="Emblem sales" value={commas(s?.sales)} />
        <Stat label="Realized value" value={usdCompact(s?.realized_usd)} />
        <Stat label="Empty-shell scams" value={commas(s?.scam_shells)} />
      </div>
      <Card title="Emblem sales — realized USD per month (Counterparty cards)">
        {d?.sales_activity ? <AreaChart data={d.sales_activity} height={180} /> : <Skeleton rows={4} />}
      </Card>
      <div className="grid lg:grid-cols-3 gap-6">
        <Board title="Most-sold cards (realized USD)" rows={d?.top_sold_assets ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(usdCompact(r.usd))}</>)} />
        <Board title="Most-vaulted assets" rows={d?.top_assets ?? []} render={(r) => (<>{Asset(r.asset, r.asset_longname)}{val(`${commas(r.vaults)} vaults`)}</>)} />
        <Board title="Sales by type" rows={d?.sales_by_class ?? []} render={(r) => (<><span className="flex-1 min-w-0 truncate text-zinc-300">{CLASS_LABEL[r.sale_class] ?? r.sale_class}</span>{val(`${commas(r.sales)} · ${usdCompact(r.usd)}`)}</>)} />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Board title="Top vault funders" rows={d?.top_funders ?? []} render={(r) => (<>{Addr(r.address)}{val(`${commas(r.vaults)} funded`)}</>)} />
        <Board title="Top vault crackers" rows={d?.top_crackers ?? []} render={(r) => (<>{Addr(r.address)}{val(`${commas(r.vaults)} cracked`)}</>)} />
      </div>
    </>
  );
}
