"use client";
import { useState } from "react";

/**
 * Asset art from the CDN. Two display problems this solves (ported from the old xcp.io media.jsx):
 *  1. Crop — images aren't square (lots are portrait card art), so we object-contain (show the whole image,
 *     letterboxed on bg) instead of object-cover (which crops). With `natural`, the box takes the image's
 *     own aspect ratio (read on load) so portraits render as portraits.
 *  2. Fuzzy stamps — tiny pixel-art blown up looks blurry, so we render `image-rendering: pixelated` when the
 *     image is small (≤96px either side), is a numeric asset (A… — overwhelmingly stamps/SRC pixel art), or is
 *     a known stamp. The natural-size check on load is the universal signal; no per-asset metadata needed.
 */
export function AssetArt({
  asset, className = "", natural = false, stamp = false,
}: { asset: string; className?: string; natural?: boolean; stamp?: boolean }) {
  const [pixel, setPixel] = useState(stamp || asset[0] === "A"); // initial guess avoids a flash before load
  const [ratio, setRatio] = useState<string | undefined>();
  return (
    <img
      src={`https://cdn.xcp.io/img/full/${encodeURIComponent(asset)}`}
      alt={asset}
      loading="lazy"
      onLoad={(e) => {
        const im = e.currentTarget;
        if (!im.naturalWidth) return;
        setPixel(stamp || im.naturalWidth <= 96 || im.naturalHeight <= 96); // size = the real "should pixelate" signal
        if (natural) setRatio(`${im.naturalWidth} / ${im.naturalHeight}`);
      }}
      style={ratio ? { aspectRatio: ratio } : undefined}
      className={`bg-zinc-900 object-contain ${pixel ? "[image-rendering:pixelated]" : ""} ${className}`}
    />
  );
}
