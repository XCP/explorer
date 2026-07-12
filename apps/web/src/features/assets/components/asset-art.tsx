"use client";
import { useState } from "react";
import { artUrl, rawArtUrl } from "@/lib/art";

/**
 * Asset art from the CDN. Display problems this solves (ported from the old xcp.io media.jsx):
 *  1. Crop — images aren't square (lots are portrait card art), so we object-contain (show the whole image,
 *     letterboxed on bg) instead of object-cover (which crops). With `natural`, the box takes the image's
 *     own aspect ratio (read on load) so portraits render as portraits.
 *  2. Fuzzy stamps — tiny pixel-art blown up looks blurry, so we render `image-rendering: pixelated` when the
 *     image is small (≤96px either side), is a numeric asset (A… — overwhelmingly stamps/SRC pixel art), or is
 *     a known stamp. The natural-size check on load is the universal signal; no per-asset metadata needed.
 *  3. Non-image media — Cloudflare Image Resizing 9412s when the origin file isn't an image (TRAMPS is a
 *     video/mp4). The cascade catches the error: resized <img> → RAW un-scaled <img> → <video muted loop>.
 *     No per-asset metadata needed; each stage only triggers on the previous one's onError.
 */
export function AssetArt({
  asset,
  className = "",
  natural = false,
  stamp = false,
  priority = false,
  w = 640,
  video = false,
}: {
  asset: string;
  className?: string;
  natural?: boolean;
  stamp?: boolean;
  priority?: boolean;
  w?: number;
  video?: boolean;
}) {
  const [pixel, setPixel] = useState(stamp || asset[0] === "A"); // initial guess avoids a flash before load
  const [ratio, setRatio] = useState<string | undefined>();
  // `video` = the wire's one-bit hint (the ingest-stamped tag) — skip the error cascade entirely
  const [stage, setStage] = useState<"resized" | "raw" | "video">(video ? "video" : "resized");

  if (stage === "video") {
    return (
      <video
        src={rawArtUrl(asset)}
        className={`bg-zinc-900 object-contain ${className}`}
        style={ratio ? { aspectRatio: ratio } : undefined}
        autoPlay
        muted
        loop
        playsInline
        aria-label={asset}
      />
    );
  }
  return (
    <img
      src={stage === "resized" ? artUrl(asset, w, "full") : rawArtUrl(asset)}
      alt={asset}
      // The plate hero is the LCP element — load it eagerly at high priority; lazy everywhere else.
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      onError={() => setStage(stage === "resized" ? "raw" : "video")}
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
