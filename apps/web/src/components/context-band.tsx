import Link from "next/link";
import type { AssetDetail } from "@xcp/shared/assets";
import { collectionLabel, commas } from "@/lib/format";

/**
 * The v19 contextual band (design-lab/v19-banner.html): ONE slot under the tab bar, one variant per
 * asset context — amber = integrity, green = collection, zinc = structural (subasset parentage).
 * Priority when several apply: integrity > collection > structural; only ONE ever renders. It sits
 * between the tab-bar band and the panels (DetailTabs' `banner` slot) and persists across tabs.
 */
export function ContextBand({ detail, collectionAssets }: {
  detail: AssetDetail;
  /** member count of the asset's collection tag (n_assets from /v2/tags/:tag), when known */
  collectionAssets?: number | null;
}) {
  if (detail.quality?.low_quality) {
    return (
      <div className="ctxband integrity">
        <span className="msg"><b>⚠ Trading integrity flags:</b> <span>high self-trade share — see Quality</span></span>
      </div>
    );
  }
  if (detail.collection) {
    // Refined inline on desktop, centered placard on mobile (design-lab options 1 + 3). One markup: `.cb-flow`
    // is display:contents on desktop (count sits left, links push right) and a centered meta row on mobile.
    const tagHref = `/tag/${encodeURIComponent(detail.collection)}`;
    const site = detail.collection_site;
    const hasSC = detail.collection_series != null && detail.collection_card != null;
    const label = collectionLabel(detail.collection);
    return (
      <div className="ctxband collection">
        {/* "Part of" reads as the lead on desktop and as an eyebrow on mobile — it frames what the band means. */}
        <span className="cb-eyebrow">Part of</span>
        {/* The name IS the project link: its own site when we have one (else our collection page). */}
        <b className="cb-name">
          {site
            ? <a href={site} target="_blank" rel="noopener noreferrer">{label} ↗</a>
            : <Link href={tagHref}>{label}</Link>}
        </b>
        {hasSC && <span className="cb-sc">Series {detail.collection_series} · Card {detail.collection_card}</span>}
        <span className="cb-flow">
          {collectionAssets != null && <span className="cb-count">{commas(collectionAssets)} cards</span>}
          {collectionAssets != null && <span className="cb-dot">·</span>}
          <Link className="cb-view" href={tagHref}>View collection →</Link>
        </span>
      </div>
    );
  }
  if (detail.asset_longname?.includes(".")) {
    const parent = detail.asset_longname.split(".")[0];
    return (
      <div className="ctxband structural">
        <span className="msg"><b>Subasset of {parent}</b></span>
        <Link href={`/asset/${encodeURIComponent(parent)}`}>View {parent} →</Link>
      </div>
    );
  }
  return null;
}
