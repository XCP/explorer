import { NextResponse } from "next/server";

/**
 * Legacy-URL tombstone. The PHP-era site lived under locale prefixes (/en/block/954678, …) and
 * crawlers still sweep that inventory years later — previously each hit was an UNCACHEABLE SSR 404
 * (private, no-store), i.e. the most expensive response we serve, repeatable forever. These paths
 * now die here as a cacheable 410 Gone: no render, de-indexes the URL (410 is the strongest removal
 * signal; a 301 would just invite the crawler back), and a zone cache rule holds it at the edge so
 * repeat hits never reach the worker at all. The matcher keeps this middleware OFF every real route.
 */
export function middleware() {
  return new NextResponse("Gone. This URL scheme was retired; the explorer lives at https://xcp.io/.", {
    status: 410,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

export const config = {
  matcher: ["/:locale((?:en|es|de|fr|it|ja|ko|nl|pl|pt|ru|tr|uk|zh|cn|jp))/:path*"],
};
