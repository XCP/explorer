"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { AssetCohortRow } from "@xcp/shared/assets";
import type { TagDetail } from "@xcp/shared/tags";
import { apiUrl, type Envelope } from "@/lib/api";
import { collectionLabel, commas } from "@/lib/format";

// One v19 gallery card: full art on top, mono name, one-line "why it's here".
function GalleryCard({ asset, name, why }: { asset: string; name: string; why: ReactNode }) {
  return (
    <Link className="g-card" href={`/asset/${encodeURIComponent(asset)}`}>
      <div className="g-art"><img src={`https://cdn.xcp.io/img/full/${encodeURIComponent(asset)}`} loading="lazy" alt="" /></div>
      <div className="g-meta">
        <div className="g-name">{name}</div>
        <div className="g-why">{why}</div>
      </div>
    </Link>
  );
}

/**
 * The v19 Related tab (design-lab/v19-banner.html): the same-collection gallery first (from the
 * collection tag's members, self excluded), then the "holders also collect" cohort. This component
 * mounts only while its tab is selected (DetailTabs renders just the active panel), so both reads
 * are lazy.
 */
export function RelatedTab({ asset, collection }: { asset: string; collection: string | null }) {
  // limit 13 so twelve remain after excluding the asset itself
  const { data: tag } = useSWR<Envelope<TagDetail>>(
    collection ? apiUrl(`/v2/tags/${encodeURIComponent(collection)}`, { limit: 13 }) : null
  );
  const members = (tag?.result?.members ?? []).filter((m) => m.asset !== asset).slice(0, 12);
  const { data: cohort } = useSWR<Envelope<AssetCohortRow[]>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/cohort`));
  const alsoCollect = (cohort?.result ?? []).slice(0, 6);
  return (
    <>
      {collection && members.length > 0 && (
        <div>
          <div className="strip-title">Same collection · {collectionLabel(collection)}</div>
          <div className="gallery">
            {members.map((m) => (
              <GalleryCard key={m.asset} asset={m.asset} name={m.asset_longname || m.asset}
                why={<>{m.tier}{m.score != null && <> <b>{m.score}</b></>}</>} />
            ))}
          </div>
        </div>
      )}
      {alsoCollect.length > 0 && (
        <div>
          <div className="strip-title">Holders also collect</div>
          <div className="gallery">
            {alsoCollect.map((r) => (
              <GalleryCard key={r.asset} asset={r.asset} name={r.asset_longname || r.asset}
                why={<><b>{commas(r.shared)}</b> co-holders</>} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
