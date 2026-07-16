"use client";
import { useState } from "react";
import { ART_WIDTH, artUrl, rawArtUrl, type ArtWidth } from "@/lib/art";

/** Whole-frame asset media with pixel-art detection and image → original → video fallback. */
export function AssetArt({
  asset,
  className = "",
  natural = false,
  stamp = false,
  priority = false,
  w = ART_WIDTH.card,
  video = false,
  original = false,
}: {
  asset: string;
  className?: string;
  natural?: boolean;
  stamp?: boolean;
  priority?: boolean;
  w?: ArtWidth;
  video?: boolean;
  original?: boolean;
}) {
  const [pixel, setPixel] = useState(stamp || asset[0] === "A"); // initial guess avoids a flash before load
  const [ratio, setRatio] = useState<string | undefined>();
  // `video` = the wire's one-bit hint (the ingest-stamped tag) — skip the error cascade entirely
  const [stage, setStage] = useState<"resized" | "raw" | "video">(video ? "video" : original ? "raw" : "resized");

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
