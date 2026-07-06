import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Flame, Hammer, Key } from "lucide-react";
import type { AssetDetail } from "@xcp/shared/assets";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { Card, KV } from "@/components/ui/card";
import { LockBadge } from "@/components/ui/badges";
import { AssetArt } from "@/components/asset-art";
import { MarketChip } from "@/components/market-chip";
import { AssetTabs } from "@/components/asset-tabs";
import { AssetCohort, HolderQuality } from "@/components/relationships";
import { HolderMakeup } from "@/components/holder-makeup";
import { PendingActions } from "@/components/pending-actions";
import { commas } from "@/lib/format";

// Server-fetch the asset once; generateMetadata + the page both call this (Next dedupes the fetch).
// Returns null on 404 — only the PAGE calls notFound() (notFound() inside generateMetadata renders
// the error boundary instead of the 404 route under OpenNext); metadata degrades to a plain title.
async function loadAsset(asset: string): Promise<AssetDetail | null> {
  try {
    const env = await getJson<Envelope<AssetDetail>>(`/v2/assets/${encodeURIComponent(asset)}`, { revalidate: 30 });
    return env.result ?? null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ asset: string }> }): Promise<Metadata> {
  const { asset } = await params;
  const item = await loadAsset(asset);
  if (!item) return { title: "Not found" };
  const name = item.asset_longname || item.asset;
  const description = (item.description?.trim()
    || `Counterparty asset ${name} — ${commas(item.holder_count)} holders, supply ${commas(item.supply_normalized)}.`).slice(0, 200);
  const image = `https://cdn.xcp.io/img/full/${encodeURIComponent(item.asset)}`;
  return {
    title: name,
    description,
    openGraph: { title: `${name} | XCP.io`, description, images: [{ url: image }] },
    twitter: { card: "summary", title: `${name} | XCP.io`, description, images: [image] },
  };
}

export default async function AssetPage({ params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const item = await loadAsset(asset);
  if (!item) notFound();

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
              <KV k="Issuer" v={item.issuer ? <span className="inline-flex items-center gap-1"><Hammer className="size-3 text-zinc-500 shrink-0" /><Link href={`/address/${item.issuer}`} className="font-mono break-all">{item.issuer}</Link></span> : "—"} />
              <KV k="Owner" v={item.owner ? <span className="inline-flex items-center gap-1"><Key className="size-3 text-zinc-500 shrink-0" /><Link href={`/address/${item.owner}`} className="font-mono break-all">{item.owner}</Link></span> : "—"} />
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
      <PendingActions asset={item.asset} />
      <HolderMakeup asset={item.asset} />
      <HolderQuality asset={item.asset} />
      <AssetCohort asset={item.asset} />
      <AssetTabs asset={item.asset} issuer={item.issuer} />
    </>
  );
}
