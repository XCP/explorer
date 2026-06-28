"use client";
import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useAsset } from "@/lib/hooks";
import { apiUrl, type Envelope } from "@/lib/api";
import { Flame, Landmark, Hammer, Key } from "lucide-react";
import { Card, KV, AssetArt, LockBadge, Loading, ErrorBox, Empty } from "@/components/ui";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { AssetCohort, HolderQuality } from "@/components/relationships";
import { HolderMakeup } from "@/components/holder-makeup";
import { bl, tx, ad, as, time, ORDER_COLS, ASSET_LIST_COLS, DISPENSER_COLS } from "@/lib/indexes";
import { commas, short } from "@/lib/format";

// Live market chip from xcpdex (cross-app composition) — only renders if the asset trades.
function MarketChip({ asset }: { asset: string }) {
  // XCP/BTC have no meaningful self-market (priced in XCP); skip the chip for native assets.
  const native = asset === "XCP" || asset === "BTC";
  const { data } = useSWR<Envelope<any>>(native ? null : apiUrl(`/v2/assets/${encodeURIComponent(asset)}/market`));
  const m = data?.result;
  if (!m || m.last_price == null) return null;
  const chg = m.price_change_7d;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <span className="text-xs text-zinc-500">Market · xcpdex</span>
      <span className="font-mono text-zinc-100">{m.last_price} <span className="text-zinc-500 text-xs">XCP</span></span>
      {m.volume_7d != null && <span className="font-mono text-xs text-zinc-400">vol {commas(m.volume_7d)} (7d)</span>}
      {chg != null && <span className={`font-mono text-xs ${chg >= 0 ? "text-green-500" : "text-red-500"}`}>{chg >= 0 ? "+" : ""}{Number(chg).toFixed(1)}% 7d</span>}
    </div>
  );
}

export default function AssetPage({ params }: { params: Promise<{ asset: string }> }) {
  const { asset } = use(params);
  const { item, error, isLoading } = useAsset(asset);
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!item) return <Empty what="asset" />;

  const base = `/v2/assets/${encodeURIComponent(item.asset)}`;
  const tabs: TabDef[] = [
    { label: "Holders", path: `${base}/balances`, cols: [
      { label: "Holder", cell: (r) => (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {r.holder_type === "address" ? ad(r.holder) : <span className="font-mono">{short(r.holder)}</span>}
          {r.is_burn ? <span className="inline-flex items-center gap-0.5 rounded bg-orange-500/10 text-orange-400 px-1.5 py-0.5 text-[10px] ring-1 ring-inset ring-orange-500/20 shrink-0"><Flame className="size-2.5" />burn</span> : null}
          {r.is_exchange ? <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/10 text-violet-300 px-1.5 py-0.5 text-[10px] ring-1 ring-inset ring-violet-500/20 shrink-0"><Landmark className="size-2.5" />exchange</span> : null}
        </span>
      ) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    ]},
    { label: "Issuances", path: `${base}/issuances`, cols: [
      { label: "Block", numeric: true, cell: (r) => bl(r.block_index) }, { label: "Time", cell: (r) => time(r.block_time) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
      { label: "Issuer", cell: (r) => ad(r.issuer) }, { label: "Tx", cell: (r) => tx(r.tx_hash) },
    ]},
    { label: "Dispensers", path: `${base}/dispensers`, cols: DISPENSER_COLS },
    { label: "Dispenses", path: `${base}/dispenses`, cols: [
      { label: "Block", numeric: true, cell: (r) => bl(r.block_index) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.dispense_quantity_normalized) },
      { label: "Buyer", cell: (r) => ad(r.destination) }, { label: "Tx", cell: (r) => tx(r.tx_hash) },
    ]},
    { label: "Orders", path: `${base}/orders`, cols: ORDER_COLS },
    { label: "Sends", path: `${base}/sends`, cols: [
      { label: "Block", numeric: true, cell: (r) => bl(r.block_index) },
      { label: "From", cell: (r) => ad(r.source) }, { label: "To", cell: (r) => ad(r.destination) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) }, { label: "Tx", cell: (r) => tx(r.tx_hash) },
    ]},
    { label: "Subassets", path: `${base}/subassets`, cols: ASSET_LIST_COLS },
    ...(item.issuer ? [{ label: "From issuer", path: `/v2/addresses/${item.issuer}/issued`, cols: ASSET_LIST_COLS }] : []),
  ];

  return (
    <>
      <Card>
        <div className="flex flex-col sm:flex-row gap-5">
          <AssetArt asset={item.asset} natural stamp={item.tags?.includes("stamp")} className="w-36 sm:w-44 rounded-lg border border-zinc-800 shrink-0 mx-auto sm:mx-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-zinc-100 break-all">{item.asset_longname || item.asset}</h1>
              <LockBadge locked={item.locked} />
            </div>
            <div className="mt-3 grid sm:grid-cols-2 gap-x-6">
              <KV k="Asset" v={<span className="font-mono">{item.asset}</span>} />
              <KV k="Supply" v={<span className="font-mono">{commas(item.supply_normalized)}</span>} />
              {Number(item.burned) > 0 && <KV k="Circulating" v={<span className="font-mono">{commas(item.circulating_normalized)}</span>} />}
              {Number(item.burned) > 0 && <KV k="Burned" v={<span className="font-mono inline-flex items-center gap-1 text-orange-400"><Flame className="size-3" />{commas(item.burned_normalized)}</span>} />}
              <KV k="Divisible" v={item.divisible ? "yes" : "no"} />
              <KV k="Holders" v={commas(item.holder_count)} />
              <KV k="Issuer" v={item.issuer ? <span className="inline-flex items-center gap-1"><Hammer className="size-3 text-zinc-500 shrink-0" /><Link href={`/address/${item.issuer}`} className="font-mono">{short(item.issuer)}</Link></span> : "—"} />
              <KV k="Owner" v={item.owner ? <span className="inline-flex items-center gap-1"><Key className="size-3 text-zinc-500 shrink-0" /><Link href={`/address/${item.owner}`} className="font-mono">{short(item.owner)}</Link></span> : "—"} />
            </div>
            {item.tags?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{item.tags.map((t: string) => <span key={t} className="rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.5 text-[10px]">{t}</span>)}</div> : null}
            {item.description && <p className="mt-2 text-sm text-zinc-400 break-all">{item.description}</p>}
            <MarketChip asset={item.asset} />
            <div className="mt-3 flex gap-2 text-xs">
              <a href={`https://xcpdex.com/${item.asset}`} target="_blank" rel="noopener noreferrer" className="rounded border border-zinc-700 px-2 py-1 !text-zinc-300 hover:!text-zinc-100 !no-underline">Trade on xcpdex ↗</a>
            </div>
          </div>
        </div>
      </Card>
      <HolderMakeup asset={item.asset} />
      <HolderQuality asset={item.asset} />
      <AssetCohort asset={item.asset} />
      <DetailTabs tabs={tabs} />
    </>
  );
}
