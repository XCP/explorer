import Link from "next/link";
import type { Route } from "next";
import type { AssetDetail } from "@xcp/shared/assets";
import { collectionLabel, commas } from "@/lib/format";

/**
 * The v19 contextual band (design-lab/v19-banner.html): ONE slot under the tab bar, one variant per
 * asset context — amber = integrity, green = collection, zinc = structural (subasset parentage).
 * Priority when several apply: integrity > collection > structural; only ONE ever renders. It sits
 * between the tab-bar band and the panels (DetailTabs' `banner` slot) and persists across tabs.
 */
export function ContextBand({
  detail,
  collectionAssets,
}: {
  detail: AssetDetail;
  /** member count of the asset's collection tag (n_assets from /v2/tags/:tag), when known */
  collectionAssets?: number | null;
}) {
  // Integrity verdicts — each flag is its own plain sentence; both can apply (low_quality = fake flow,
  // insular = the holder ring behind it). The insular sentence carries the raw counts in its title.
  const integrity: { text: string; title?: string }[] = [];
  if (detail.quality?.low_quality) integrity.push({ text: "high self-trade share — see Quality" });
  if (detail.cohesion?.insular)
    integrity.push({
      text: "insular holder base — top holders trade mostly among themselves",
      title: `${detail.cohesion.edges} interaction ties among the top holders${detail.cohesion.strong ? `, ${detail.cohesion.strong} strong (4+ repeats)` : ""} · cohesion ${detail.cohesion.score.toFixed(1)} (traded-asset median ≈ 4)`,
    });
  if (integrity.length) {
    return (
      <div className="ctxband integrity">
        <span className="msg">
          <b>⚠ Trading integrity flags:</b>{" "}
          {integrity.map((f, i) => (
            <span key={i} title={f.title}>
              {i > 0 && " · "}
              {f.text}
            </span>
          ))}
        </span>
      </div>
    );
  }
  if (detail.collection) {
    // Refined inline on desktop, centered placard on mobile (design-lab options 1 + 3). One markup: `.cb-flow`
    // is display:contents on desktop (count sits left, links push right) and a centered meta row on mobile.
    const tagHref = `/tag/${encodeURIComponent(detail.collection)}` as Route;
    const site = detail.collection_site;
    const hasSC = detail.collection_series != null && detail.collection_card != null;
    const label = collectionLabel(detail.collection);
    return (
      <div className="ctxband collection">
        {/* One bold phrase, "Part of <Name>", where the name is the only link — its own site when we have one,
            else our collection page. Series/card + the collection size trail in muted text. */}
        <span className="msg">
          <b>
            Part of{" "}
            {site ? (
              <a href={site} target="_blank" rel="noopener noreferrer">
                {label}
              </a>
            ) : (
              <Link href={tagHref}>{label}</Link>
            )}
          </b>
          {hasSC && (
            <span>
              {" "}
              · Series {detail.collection_series} · Card {detail.collection_card}
            </span>
          )}
          {collectionAssets != null && <span> · {commas(collectionAssets)} cards in collection</span>}
        </span>
        <Link className="cb-view" href={tagHref}>
          View collection →
        </Link>
      </div>
    );
  }
  if (detail.asset_longname?.includes(".")) {
    const parent = detail.asset_longname.split(".")[0];
    return (
      <div className="ctxband structural">
        <span className="msg">
          <b>Subasset of {parent}</b>
        </span>
        <Link href={`/asset/${encodeURIComponent(parent)}`}>View {parent} →</Link>
      </div>
    );
  }
  return null;
}
