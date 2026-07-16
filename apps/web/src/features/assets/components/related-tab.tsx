"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { AssetCohortRow, AssetRelated } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { collectionLabel, commas } from "@/lib/format";
import { AssetArt } from "@/features/assets/components/asset-art";
import { ART_WIDTH } from "@/lib/art";

// One v19 gallery card: full art on top, mono name, one-line "why it's here".
function GalleryCard({ asset, name, why }: { asset: string; name: string; why: ReactNode }) {
  return (
    <Link className="g-card" href={`/asset/${encodeURIComponent(asset)}`}>
      <div className="g-art">
        <AssetArt asset={asset} w={ART_WIDTH.card} className="size-full" />
      </div>
      <div className="g-meta">
        <div className="g-name">{name}</div>
        <div className="g-why">{why}</div>
      </div>
    </Link>
  );
}

// The relatedness reason (v19 "g-why"): what fraction of THIS asset's holders also hold the related one.
// The co-hold overlap IS the relationship — that's why it's on the tab. Falls back to the raw count if the
// percentage can't be computed (subject has no counted holders).
function coHold(r: AssetCohortRow): ReactNode {
  return r.pct != null ? (
    <>
      <b>{r.pct}%</b> of holders co-hold
    </>
  ) : (
    <>
      <b>{commas(r.shared)}</b> co-holders
    </>
  );
}

/**
 * The v19 Related tab (design-lab/v19-banner.html): the same-collection gallery first (siblings ranked by
 * how strongly they share this asset's holders), then the broader "holders also collect" cohort. Every card
 * states WHY it's related — the co-hold overlap — not a quality score. One purpose-built read (/related)
 * resolves the collection server-side and returns both strips; this component mounts only while its tab is
 * selected (DetailTabs renders just the active panel), so the read is lazy.
 */
export function RelatedTab({ asset, collection }: { asset: string; collection: string | null }) {
  const { data } = useSWR<Envelope<AssetRelated>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/related`));
  const sameCollection = data?.result?.collection ?? [];
  const alsoCollect = data?.result?.cohort ?? [];
  return (
    <>
      {collection && sameCollection.length > 0 && (
        <div>
          <div className="strip-title">Same collection · {collectionLabel(collection)}</div>
          <div className="gallery">
            {sameCollection.map((m) => (
              <GalleryCard key={m.asset} asset={m.asset} name={m.asset_longname || m.asset} why={coHold(m)} />
            ))}
          </div>
        </div>
      )}
      {alsoCollect.length > 0 && (
        <div>
          <div className="strip-title">Holders also collect</div>
          <div className="gallery">
            {alsoCollect.map((r) => (
              <GalleryCard key={r.asset} asset={r.asset} name={r.asset_longname || r.asset} why={coHold(r)} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
