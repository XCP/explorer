"use client";
import { useState } from "react";
import { ART_WIDTH, artUrl, rawArtUrl, stampUrl, type ArtWidth } from "@/lib/art";

/** Whole-frame asset media with pixel-art detection and image → original → video fallback. */
export function AssetArt({
  asset,
  className = "",
  natural = false,
  stamp = false,
  priority = false,
  w = ART_WIDTH.card,
  video = false,
  html = false,
  original = false,
}: {
  asset: string;
  className?: string;
  natural?: boolean;
  stamp?: boolean;
  priority?: boolean;
  w?: ArtWidth;
  video?: boolean;
  html?: boolean;
  original?: boolean;
}) {
  const [pixel, setPixel] = useState(stamp || asset[0] === "A"); // initial guess avoids a flash before load
  const [ratio, setRatio] = useState<string | undefined>();
  // `video`/`html` = the wire's one-bit hints (the ingest-stamped tags) — skip the error cascade entirely
  const [stage, setStage] = useState<"resized" | "raw" | "video">(video ? "video" : original ? "raw" : "resized");
  const [run, setRun] = useState(false);

  if (html) {
    // HTML stamp: on-chain code, not an image. Render-on-click keeps arbitrary scripts from
    // autoplaying; the sandbox + the credential-less CDN origin are the isolation boundary
    // (never mount stamp HTML on xcp.io itself). "view source" serves the exact on-chain bytes.
    return run ? (
      <iframe
        src={stampUrl(asset)}
        sandbox="allow-scripts allow-same-origin"
        loading="lazy"
        title={`${asset} HTML stamp`}
        className={`aspect-square w-full border-0 bg-zinc-900 ${className}`}
      />
    ) : (
      <div className={`aspect-square w-full bg-zinc-900 flex flex-col items-center justify-center gap-3 ${className}`}>
        <div className="font-mono text-xs uppercase tracking-widest text-zinc-500">html stamp · on-chain code</div>
        <button
          type="button"
          onClick={() => setRun(true)}
          className="btn2 primary"
          aria-label={`Render the ${asset} HTML stamp`}
        >
          ▶ Render
        </button>
        <a
          href={stampUrl(asset, true)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-zinc-400 underline underline-offset-2"
        >
          view source ↗
        </a>
      </div>
    );
  }
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
