// Asset art URLs through Cloudflare Image Resizing (enabled on the cdn.xcp.io zone). `format=auto` serves
// AVIF/WebP by the browser's Accept header; `fit=scale-down` shrinks large card art but NEVER upscales, so
// pixel-art stamps stay crisp and already-tiny images are untouched. A 200KB card JPEG becomes a ~26KB AVIF —
// the biggest single image win, and it needs no change to the CDN itself. `width` is the max render width in
// device px (pass ~2× the CSS size for retina); the origin path stays /img/{kind}/{asset}.
export function artUrl(asset: string, width: number, kind: "full" | "icon" = "full"): string {
  return `https://cdn.xcp.io/cdn-cgi/image/format=auto,fit=scale-down,width=${width},quality=82/img/${kind}/${encodeURIComponent(asset)}`;
}

/** The un-resized origin URL — the fallback when Image Resizing refuses the file (video/mp4 card art,
 *  oversized GIFs → error 9412). AssetArt cascades: resized → raw <img> → <video>. */
export function rawArtUrl(asset: string, kind: "full" | "icon" = "full"): string {
  return `https://cdn.xcp.io/img/${kind}/${encodeURIComponent(asset)}`;
}
