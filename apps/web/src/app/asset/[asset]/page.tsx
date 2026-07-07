import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Flame, Hammer, Key } from "lucide-react";
import type { AssetDetail } from "@xcp/shared/assets";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { Card, KV } from "@/components/ui/card";
import { AssetIcon } from "@/components/ui/badges";
import { SectionHeader, SectionIdentity, SectionStats, SectionChip, type SectionStat } from "@/components/section-header";
import { AssetArt } from "@/components/asset-art";
import { MarketChip } from "@/components/market-chip";
import { AssetTabs } from "@/components/asset-tabs";
import { AssetCohort, HolderQuality } from "@/components/relationships";
import { HolderMakeup } from "@/components/holder-makeup";
import { PendingActions } from "@/components/pending-actions";
import { GraphTrustChip } from "@/components/graph-trust-chip";
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

// The band's stat strip — the asset's headline numbers, all already on the fetched detail row.
// Mobile shows at most the first four; the tail entries hide (hideOnMobile).
function assetStats(item: AssetDetail): SectionStat[] {
  const stats: SectionStat[] = [];
  if (item.quality) stats.push({ label: "Score", value: item.quality.score ?? "—", detail: item.quality.tier });
  stats.push({ label: "Holders", value: commas(item.holder_count) });
  stats.push({ label: "Supply", value: commas(item.supply_normalized) });
  if (item.first_issuance_block_index != null) {
    const year = item.first_issuance_block_time ? new Date(item.first_issuance_block_time * 1000).getUTCFullYear() : null;
    stats.push({
      label: "Issued",
      value: year ?? commas(item.first_issuance_block_index),
      detail: year != null ? `block ${commas(item.first_issuance_block_index)}` : undefined,
    });
  }
  stats.push({ label: "Divisible", value: item.divisible ? "yes" : "no", hideOnMobile: true });
  if (Number(item.burned) > 0) stats.push({ label: "Circulating", value: commas(item.circulating_normalized), hideOnMobile: true });
  return stats;
}

export default async function AssetPage({ params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const item = await loadAsset(asset);
  if (!item) notFound();

  return (
    <>
      <SectionHeader flush>
        <SectionIdentity
          visual={<AssetIcon asset={item.asset} size={52} />}
          name={item.asset_longname || item.asset}
          chips={<>
            {item.tags?.includes("grail") && <SectionChip variant="grail">grail</SectionChip>}
            <SectionChip variant={item.locked ? "locked" : "open"}>{item.locked ? "locked" : "open"}</SectionChip>
            <GraphTrustChip kind="assets" id={item.asset} />
          </>}
          actions={
            <a href={`https://xcpdex.com/${item.asset}`} target="_blank" rel="noopener noreferrer" className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium !text-zinc-200 hover:!text-zinc-100 hover:border-zinc-500 !no-underline">Trade on xcpdex ↗</a>
          }
        />
        <SectionStats stats={assetStats(item)} />
      </SectionHeader>
      <AssetTabs asset={item.asset} issuer={item.issuer} inBand />
      <Card>
        <div className="flex flex-col sm:flex-row gap-5">
          <AssetArt asset={item.asset} natural stamp={item.tags?.includes("stamp")} className="w-36 sm:w-44 rounded-lg border border-zinc-800 shrink-0 mx-auto sm:mx-0" />
          <div className="flex-1 min-w-0">
            <div className="grid sm:grid-cols-2 gap-x-6">
              <KV k="Asset" v={<span className="font-mono">{item.asset}</span>} />
              {Number(item.burned) > 0 && <KV k="Burned" v={<span className="font-mono inline-flex items-center gap-1 text-orange-400"><Flame className="size-3" />{commas(item.burned_normalized)}</span>} />}
              <KV k="Issuer" v={item.issuer ? <span className="inline-flex items-center gap-1"><Hammer className="size-3 text-zinc-500 shrink-0" /><Link href={`/address/${item.issuer}`} className="font-mono break-all">{item.issuer}</Link></span> : "—"} />
              <KV k="Owner" v={item.owner ? <span className="inline-flex items-center gap-1"><Key className="size-3 text-zinc-500 shrink-0" /><Link href={`/address/${item.owner}`} className="font-mono break-all">{item.owner}</Link></span> : "—"} />
            </div>
            {item.tags?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{item.tags.map((t: string) => <Link key={t} href={`/tag/${encodeURIComponent(t)}`} className="rounded bg-zinc-800 text-zinc-300 hover:text-(--color-accent) px-1.5 py-0.5 text-[10px] !no-underline">{t}</Link>)}</div> : null}
            {item.description && <p className="mt-2 text-sm text-zinc-400 break-all">{item.description}</p>}
            <MarketChip asset={item.asset} />
          </div>
        </div>
      </Card>
      <PendingActions asset={item.asset} />
      <HolderMakeup asset={item.asset} />
      <HolderQuality asset={item.asset} />
      <AssetCohort asset={item.asset} />

    </>
  );
}
