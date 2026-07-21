import { NextResponse } from "next/server";

/**
 * Legacy-URL tombstone. The PHP-era site lived under locale prefixes (/en/block/954678, …) and
 * crawlers still sweep that inventory years later — previously each hit was an UNCACHEABLE SSR 404
 * (private, no-store), i.e. the most expensive response we serve, repeatable forever. These paths
 * now die here as a cacheable 410 Gone: no render, de-indexes the URL (410 is the strongest removal
 * signal; a 301 would just invite the crawler back), and a zone cache rule holds it at the edge so
 * repeat hits never reach the worker at all. The address matcher also cheaply rejects transaction
 * hashes put in the address namespace, while passing real address routes through unchanged.
 */
export function middleware(request: Request) {
  const { pathname } = new URL(request.url);
  const transactionHashInAddressRoute = /^\/address\/[0-9a-f]{64}$/i.test(pathname);
  const legacyLocaleRoute = /^\/(?:en|es|de|fr|it|ja|ko|nl|pl|pt|ru|tr|uk|zh|cn|jp)(?:\/|$)/.test(pathname);

  if (!transactionHashInAddressRoute && !legacyLocaleRoute) return NextResponse.next();

  const body = transactionHashInAddressRoute
    ? "Gone. Transaction hashes are not Bitcoin addresses."
    : "Gone. This URL scheme was retired; the explorer lives at https://xcp.io/.";

  return new NextResponse(body, {
    status: 410,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export const config = {
  matcher: ["/:locale((?:en|es|de|fr|it|ja|ko|nl|pl|pt|ru|tr|uk|zh|cn|jp))/:path*", "/address/:candidate"],
};
