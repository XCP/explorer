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
    return (
      <div className="ctxband collection">
        <span className="msg">
          <b>Part of {collectionLabel(detail.collection)}</b>
          {collectionAssets != null && <span> · {commas(collectionAssets)} assets in collection</span>}
        </span>
        {detail.collection_site && (
          <a href={detail.collection_site} target="_blank" rel="noopener noreferrer">Project site ↗</a>
        )}
        <Link href={`/tag/${encodeURIComponent(detail.collection)}`}>View collection →</Link>
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
