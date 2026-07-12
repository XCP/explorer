import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Trophy, CalendarDays, LockOpen } from "lucide-react";
import type { AssetDetail, AssetMarket } from "@xcp/shared/assets";
import type { TagDetail } from "@xcp/shared/tags";
import { getJson, NotFoundError, type Envelope } from "@/lib/api/server";
import { SectionHeader, SectionIdentity, SectionStats, SectionChip, type SectionStat } from "@/components/section-header";
import { AssetArt } from "@/components/asset-art";
import { AssetTabs } from "@/components/asset-tabs";
import { AssetClassifications } from "@/components/asset-classifications";
import { AssetDescription } from "@/components/asset-description";
import { ContextBand } from "@/components/context-band";
import { HolderMakeup } from "@/components/holder-makeup";
import { PendingActions } from "@/components/pending-actions";
import { amount, collectionLabel, commas, compact, short, timeAgo, usdCompact } from "@/lib/format";

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
  // Skip on-chain image-data descriptions (STAMP/ord/data URIs, or any long unbroken blob) — they're bytes,
  // not prose, and make a useless meta description. Fall back to a generated summary instead.
  const raw = item.description?.trim() || "";
  const usable = raw && !/^(stamp:|ord:|data:)/i.test(raw) && !/\S{80,}/.test(raw) ? raw : "";
  const description = (usable
    || `Counterparty asset ${name} — ${commas(item.holder_count)} holders, supply ${commas(item.supply_normalized)}.`).slice(0, 200);
  const image = `https://cdn.xcp.io/img/full/${encodeURIComponent(item.asset)}?image=1`; // always-a-picture: video assets unfurl with a frame
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
const fullDate = (sec?: number | null) => {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

// The band's stat strip — identity-first, then the market, with our editorial RATING as the payoff at the
// end (v19 reference: Circulating, Holders, Issued, Floor price, Last price, Volume, Rating). Mobile shows
// the identity head (Circulating/Holders/Issued); the market + rating tail hides (mobile-hide).
function assetStats(item: AssetDetail, market: AssetMarket | null): SectionStat[] {
  const stats: SectionStat[] = [];
  // Circulating = supply − burned (the derived circulating_normalized when present, else compute it).
  // Compacted (100B, 3.4M) since headline magnitude beats exactness; the exact total lives in Asset info.
  const circulating = item.circulating_normalized
    ?? (item.supply_normalized != null && item.burned_normalized != null
      ? Number(item.supply_normalized) - Number(item.burned_normalized)
      : item.supply_normalized);
  stats.push({ label: "Circulating", value: compact(circulating), detail: item.locked ? "locked" : "unlocked" });
  stats.push({ label: "Holders", value: commas(item.holder_count) });
  const issued = monthYear(item.first_issuance_block_time);
  if (issued) stats.push({ label: "Issued", value: issued });
  if (market?.floor_usd != null) {
    stats.push({ label: "Floor price", value: usdCompact(market.floor_usd), detail: market.floor_source ?? undefined, hideOnMobile: true });
  }
  if (item.sales?.last_price_usd != null) {
    stats.push({ label: "Last price", value: usdCompact(item.sales.last_price_usd), detail: timeAgo(item.sales.last_sale_time), hideOnMobile: true });
  }
  if (item.sales?.realized_usd != null) {
    stats.push({ label: "Volume", value: usdCompact(item.sales.realized_usd), detail: "lifetime", hideOnMobile: true });
  }
  if (item.quality) stats.push({ label: "Rating", value: item.quality.score ?? "—", detail: item.quality.tier, hideOnMobile: true });
  return stats;
}

export default async function AssetPage({ params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  // Market only needs the asset name (the route param) — fire it in PARALLEL with the detail read instead
  // of waiting for it, taking that round-trip off the TTFB path. Graceful null covers a non-canonical param.
  const marketReq = getJson<Envelope<AssetMarket | null>>(`/v2/assets/${encodeURIComponent(asset)}/market`, { revalidate: 120 }).catch(() => null);
  const item = await loadAsset(asset);
  if (!item) notFound();

  const collection = item.collection ?? null;
  // The collection-tag aggregate (green band member count) needs item.collection, so it follows the detail;
  // market was already in flight above.
  const [marketEnv, tagEnv] = await Promise.all([
    marketReq,
    collection
      ? getJson<Envelope<TagDetail>>(`/v2/tags/${encodeURIComponent(collection)}?limit=1`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const market = marketEnv?.result ?? null;
  const collectionAssets = tagEnv?.result?.n_assets ?? null;

  // The genesis year — early issuance is prestige on Counterparty (2014 = protocol dawn), so the band
  // wears the vintage as a chip instead of a graph-trust badge.
  const issuedYear = item.first_issuance_block_time
    ? new Date(item.first_issuance_block_time * 1000).getUTCFullYear()
    : null;

  // v19 plate caption: "{ASSET} · {collection}" left; "{issued} · blk {n} · {supply} supply" right.
  const capRight = [
    monthYear(item.first_issuance_block_time),
    item.first_issuance_block_index != null ? `blk ${commas(item.first_issuance_block_index)}` : null,
    item.supply_normalized != null ? `${commas(item.supply_normalized)} supply` : null,
  ].filter(Boolean).join(" · ");

  // Market data card renders only when the asset actually trades (a price, a sale, or realized value);
  // untraded assets skip the box entirely rather than show empty rows.
  const hasEscrow = item.escrow_normalized != null && Number(item.escrow_normalized) > 0;
  const hasMarket = market?.last_price != null || market?.floor_usd != null || item.sales?.last_price_usd != null || item.sales?.realized_usd != null || hasEscrow;

  // v19 overview: pending (transient) above the .mag grid — museum plate left, then the stacked
  // right column: Asset info, Market data (when traded), Holder makeup.
  const overview = (
    <>
      <PendingActions asset={item.asset} />
      <AssetClassifications tags={item.tags} />
      <div className="mag">
        <div className="plate">
          <AssetArt asset={item.asset} stamp={item.tags?.includes("stamp")} video={item.tags?.includes("video")} priority natural w={900} />
          <div className="cap">
            <span><b>{item.asset_longname || item.asset}</b> · {collection ? collectionLabel(collection) : "Counterparty asset"}</span>
            {capRight && <span>{capRight}</span>}
          </div>
        </div>
        <div className="magcol">
          <AssetDescription asset={item.asset} description={item.description} />
          <div className="card factcard">
            <h2>Asset info</h2>
            <div className="body">
              {/* One party when issuer == owner (label it Owner — it's who controls the asset now); both when they differ. */}
              {item.owner && item.owner === item.issuer ? (
                <div className="row"><span className="k">Owner</span><span className="amt mono"><Link href={`/address/${item.owner}`}>{short(item.owner)}</Link></span></div>
              ) : (
                <>
                  <div className="row"><span className="k">Issuer</span><span className="amt mono">{item.issuer ? <Link href={`/address/${item.issuer}`}>{short(item.issuer)}</Link> : "—"}</span></div>
                  {item.owner && <div className="row"><span className="k">Owner</span><span className="amt mono"><Link href={`/address/${item.owner}`}>{short(item.owner)}</Link></span></div>}
                </>
              )}
              {item.artist && <div className="row"><span className="k">Artist</span><span className="amt mono"><Link href={`/tag/${encodeURIComponent(item.artist.tag)}`}>{item.artist.name}</Link></span></div>}
              {item.collection_series != null && item.collection_card != null && <div className="row"><span className="k">Series</span><span className="amt mono">Series {item.collection_series} <span className="time">Card {item.collection_card}</span></span></div>}
              {item.first_issuance_block_index != null && <div className="row"><span className="k">Issued</span><span className="amt mono">{fullDate(item.first_issuance_block_time) ?? "—"} <span className="time">blk {commas(item.first_issuance_block_index)}</span></span></div>}
              <div className="row"><span className="k">Supply</span><span className="amt mono">{amount(item.supply_normalized, item.divisible)}{item.locked ? <> <span className="time">locked</span></> : null}</span></div>
              <div className="row"><span className="k">Divisible</span><span className="amt mono">{item.divisible ? "Yes" : "No"} <span className="time">{item.divisible ? "8 decimals" : "whole units"}</span></span></div>
              {item.burned_normalized != null && Number(item.burned_normalized) > 0 && <div className="row"><span className="k">Burned</span><span className="amt mono">{amount(item.burned_normalized, item.divisible)}</span></div>}
              {/* Conviction — who holds it + how scarce (the Radar signal, on the asset itself; zero market
                  inputs). The undervalued pill is Radar's dislocation cut: top-decile conviction, unpriced. */}
              {item.conviction && <div className="row"><span className="k">Conviction</span><span className="amt mono" title="Who holds it + how scarce — held by proven creators and active collectors across a scarce supply. No trade/volume inputs; can't be pumped."><span>{item.conviction.score}</span><span className="time">/100</span>{item.conviction.undervalued && <> <Link href="/radar" className="pill undervalued" title="Top-decile conviction but almost no realized sales — the smart money holds it and the market hasn't priced it. See Radar.">undervalued</Link></>}</span></div>}
            </div>
          </div>
          {hasMarket && (
            <div className="card">
              <h2>Market data</h2>
              <div className="body">
                {market?.floor_usd != null && <div className="row"><span className="k">Floor price</span><span className="amt mono">{usdCompact(market.floor_usd)}{market.floor_source ? <> <span className="time">{market.floor_source}</span></> : null}</span></div>}
                {hasEscrow && <div className="row"><span className="k">Escrow</span><span className="amt mono">{commas(item.escrow_normalized)} <span className="time">for sale</span></span></div>}
                {market?.last_price != null && <div className="row"><span className="k">Price</span><span className="amt mono">{commas(market.last_price)} XCP</span></div>}
                {item.sales?.last_price_usd != null && <div className="row"><span className="k">Last price</span><span className="amt mono">{usdCompact(item.sales.last_price_usd)} <span className="time">{timeAgo(item.sales.last_sale_time)}</span></span></div>}
                {item.sales?.realized_usd != null && <div className="row"><span className="k">Volume</span><span className="amt mono">{usdCompact(item.sales.realized_usd)} <span className="time">lifetime</span></span></div>}
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
            {collection && <SectionChip variant="collection">{collectionLabel(collection)}</SectionChip>}
            {issuedYear != null && <SectionChip variant="neutral"><CalendarDays className="size-3" aria-hidden /> {issuedYear}</SectionChip>}
            {!item.locked && <SectionChip variant="open"><LockOpen className="size-3" aria-hidden /> UNLOCKED</SectionChip>}
            {item.tags?.includes("grail") && <SectionChip variant="grail"><Trophy className="size-3" aria-hidden /> GRAIL</SectionChip>}
          </>}
          actions={<>
            <a href={`https://xcpdex.com/${item.asset}`} target="_blank" rel="noopener noreferrer" className="btn2">Trade on xcpdex ↗</a>
            <a href={`https://digirare.com/cards/${encodeURIComponent(item.asset)}`} target="_blank" rel="noopener noreferrer" className="btn2 primary">Collect ↗</a>
          </>}
        />
        <SectionStats stats={assetStats(item, market)} />
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
