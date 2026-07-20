// Explorer media uses a deliberately small variant set. Each additional width can create another billable
// Cloudflare transformation per asset, so callers choose a named display role instead of arbitrary pixels.
const MEDIA_CACHE_REVISION = "3";
export const ART_WIDTH = { thumbnail: 320, card: 640 } as const;
export type ArtWidth = (typeof ART_WIDTH)[keyof typeof ART_WIDTH];

export function artUrl(asset: string, width: ArtWidth, kind: "full" | "icon" = "full"): string {
  return `https://cdn.xcp.io/cdn-cgi/image/format=auto,fit=scale-down,width=${width},quality=82,onerror=redirect/img/${kind}/${encodeURIComponent(asset)}?v=${MEDIA_CACHE_REVISION}`;
}

/** Untouched R2 media for primary artwork and the image/video fallback. */
export function rawArtUrl(asset: string, kind: "full" | "icon" = "full"): string {
  return `https://cdn.xcp.io/img/${kind}/${encodeURIComponent(asset)}?v=${MEDIA_CACHE_REVISION}`;
}

/** The recursive-stamps endpoint: an asset's on-chain stamp payload (HTML pieces render from here,
 *  and their stamped dependencies resolve against the same origin). `source` = view-source variant. */
export function stampUrl(asset: string, source = false): string {
  return `https://cdn.xcp.io/s/${encodeURIComponent(asset)}${source ? "?src=1" : ""}`;
}
