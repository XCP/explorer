import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Lock, LockOpen } from "lucide-react";
import type { AssetDetail, AssetMarket } from "@xcp/shared/assets";
import type { TagDetail } from "@xcp/shared/tags";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { SectionHeader, SectionIdentity, SectionStats, SectionChip, type SectionStat } from "@/components/section-header";
import { AssetArt } from "@/components/asset-art";
import { AssetTabs } from "@/components/asset-tabs";
import { ContextBand } from "@/components/context-band";
import { HolderMakeup } from "@/components/holder-makeup";
import { PendingActions } from "@/components/pending-actions";
import { GraphTrustChip } from "@/components/graph-trust-chip";
import { collectionLabel, commas, compact, short, timeAgo, usdCompact } from "@/lib/format";

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (sec?: number | null) =>
  sec ? `${MONTHS[new Date(sec * 1000).getUTCMonth()]} ${new Date(sec * 1000).getUTCFullYear()}` : null;

// The band's stat strip — the asset's headline numbers, money-first (v19 reference: Score, Holders,
// Supply(+locked), Realized, Last sale, Issued). Mobile shows the head; the tail hides (mobile-hide).
function assetStats(item: AssetDetail): SectionStat[] {
  const stats: SectionStat[] = [];
  if (item.quality) stats.push({ label: "Score", value: item.quality.score ?? "—", detail: item.quality.tier });
  stats.push({ label: "Holders", value: commas(item.holder_count) });
  // Circulating = supply − burned (the derived circulating_normalized when present, else compute it).
  // Compacted (100B, 3.4M) since headline magnitude beats exactness; the exact total lives in Asset info.
  const circulating = item.circulating_normalized
    ?? (item.supply_normalized != null && item.burned_normalized != null
      ? Number(item.supply_normalized) - Number(item.burned_normalized)
      : item.supply_normalized);
  stats.push({ label: "Circulating", value: compact(circulating), detail: item.locked ? "locked" : undefined });
  if (item.sales?.realized_usd != null) {
    stats.push({ label: "Realized", value: usdCompact(item.sales.realized_usd), detail: "lifetime" });
  }
  if (item.sales?.last_sale_usd != null) {
    stats.push({ label: "Last sale", value: usdCompact(item.sales.last_sale_usd), detail: timeAgo(item.sales.last_sale_time), hideOnMobile: true });
  }
  if (item.first_issuance_block_index != null) {
    const year = item.first_issuance_block_time ? new Date(item.first_issuance_block_time * 1000).getUTCFullYear() : null;
    stats.push({
      label: "Issued",
      value: year ?? commas(item.first_issuance_block_index),
      detail: year != null ? `blk ${commas(item.first_issuance_block_index)}` : undefined,
      hideOnMobile: true,
    });
  }
  return stats;
}

export default async function AssetPage({ params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const item = await loadAsset(asset);
  if (!item) notFound();

  const collection = item.collection ?? null;
  // Two independent side reads for the overview + context band: the xcpdex price (fact-card Price
  // row) and the collection tag aggregate (member count on the green band). Both optional.
  const [marketEnv, tagEnv] = await Promise.all([
    getJson<Envelope<AssetMarket | null>>(`/v2/assets/${encodeURIComponent(item.asset)}/market`, { revalidate: 120 }).catch(() => null),
    collection
      ? getJson<Envelope<TagDetail>>(`/v2/tags/${encodeURIComponent(collection)}?limit=1`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const market = marketEnv?.result ?? null;
  const collectionAssets = tagEnv?.result?.n_assets ?? null;

  // v19 plate caption: "{ASSET} · {collection}" left; "{issued} · blk {n} · {supply} supply" right.
  const capRight = [
    monthYear(item.first_issuance_block_time),
    item.first_issuance_block_index != null ? `blk ${commas(item.first_issuance_block_index)}` : null,
    item.supply_normalized != null ? `${commas(item.supply_normalized)} supply` : null,
  ].filter(Boolean).join(" · ");

  // Market data card renders only when the asset actually trades (a price, a sale, or realized value);
  // untraded assets skip the box entirely rather than show empty rows.
  const hasMarket = market?.last_price != null || item.sales?.last_sale_usd != null || item.sales?.realized_usd != null;

  // v19 overview: pending (transient) above the .mag grid — museum plate left, then the stacked
  // right column: Asset info, Market data (when traded), Holder makeup.
  const overview = (
    <>
      <PendingActions asset={item.asset} />
      <div className="mag">
        <div className="plate">
          <AssetArt asset={item.asset} stamp={item.tags?.includes("stamp")} />
          <div className="cap">
            <span><b>{item.asset_longname || item.asset}</b> · {collection ? collectionLabel(collection) : "Counterparty asset"}</span>
            {capRight && <span>{capRight}</span>}
          </div>
        </div>
        <div className="magcol">
          <div className="card factcard">
            <h2>Asset info</h2>
            <div className="body">
              <div className="row"><span className="k">Issuer</span><span className="amt mono">{item.issuer ? <Link href={`/address/${item.issuer}`}>{short(item.issuer)}</Link> : "—"}</span></div>
              {item.owner && item.owner !== item.issuer && <div className="row"><span className="k">Owner</span><span className="amt mono"><Link href={`/address/${item.owner}`}>{short(item.owner)}</Link></span></div>}
              <div className="row"><span className="k">Issued</span><span className="amt mono">{commas(item.supply_normalized)}{item.locked ? <> <span className="time">locked</span></> : null}</span></div>
              {item.burned_normalized != null && Number(item.burned_normalized) > 0 && <div className="row"><span className="k">Burned</span><span className="amt mono">{commas(item.burned_normalized)}</span></div>}
              {item.escrow_normalized != null && Number(item.escrow_normalized) > 0 && <div className="row"><span className="k">Escrow</span><span className="amt mono">{commas(item.escrow_normalized)} <span className="time">for sale</span></span></div>}
            </div>
          </div>
          {hasMarket && (
            <div className="card">
              <h2>Market data</h2>
              <div className="body">
                {market?.last_price != null && <div className="row"><span className="k">Price</span><span className="amt mono">{commas(market.last_price)} XCP</span></div>}
                {item.sales?.last_sale_usd != null && <div className="row"><span className="k">Last sale</span><span className="amt mono">{usdCompact(item.sales.last_sale_usd)} <span className="time">{timeAgo(item.sales.last_sale_time)}</span></span></div>}
                {item.sales?.realized_usd != null && <div className="row"><span className="k">Realized</span><span className="amt mono">{usdCompact(item.sales.realized_usd)} <span className="time">lifetime</span></span></div>}
              </div>
            </div>
          )}
          <HolderMakeup asset={item.asset} />
        </div>
      </div>
    </>
  );

  // Subasset H1: link the top-level (parent) segment home. A subasset displays as PARENT.CHILD (its
  // longname); the part before the first dot is the owning named asset with its own page. Non-subassets
  // (no dot) render as plain text. The parent link inherits the H1 colour until hover (see .sh-name a).
  const displayName = item.asset_longname || item.asset;
  const dot = displayName.indexOf(".");
  const nameNode = dot > 0
    ? <><Link href={`/asset/${encodeURIComponent(displayName.slice(0, dot))}`}>{displayName.slice(0, dot)}</Link>{displayName.slice(dot)}</>
    : displayName;

  return (
    <>
      <SectionHeader flush>
        <SectionIdentity
          visual={<img className="icon" src={`https://cdn.xcp.io/img/icon/${encodeURIComponent(item.asset)}`} alt="" />}
          name={nameNode}
          chips={<>
            {item.tags?.includes("grail") && <SectionChip variant="grail">GRAIL</SectionChip>}
            <GraphTrustChip kind="assets" id={item.asset} />
            <SectionChip variant={item.locked ? "locked" : "open"}>{item.locked ? <><Lock className="size-3" aria-hidden /> LOCKED</> : <><LockOpen className="size-3" aria-hidden /> UNLOCKED</>}</SectionChip>
          </>}
          actions={<>
            <a href={`https://xcpdex.com/${item.asset}`} target="_blank" rel="noopener noreferrer" className="btn2">Trade on xcpdex ↗</a>
            <a href={`https://digirare.com/cards/${encodeURIComponent(item.asset)}`} target="_blank" rel="noopener noreferrer" className="btn2 primary">Collect ↗</a>
          </>}
        />
        <SectionStats stats={assetStats(item)} />
      </SectionHeader>
      <AssetTabs
        asset={item.asset}
        collection={collection}
        holderCount={item.holder_count}
        supply={item.supply_normalized != null ? Number(item.supply_normalized) : null}
        feedCounts={item.feed_counts ?? null}
        inBand
        overview={overview}
        banner={<ContextBand detail={item} collectionAssets={collectionAssets} />}
      />
    </>
  );
}
