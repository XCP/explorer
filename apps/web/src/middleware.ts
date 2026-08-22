import { NextResponse } from "next/server";

const BLOCKED_COMMERCIAL_CRAWLER = /(?:AhrefsBot|SemrushBot|MJ12bot|DotBot)/i;

/**
 * Reject expensive low-value crawlers and retire legacy URL shapes before application rendering.
 */
export function middleware(request: Request) {
  const { pathname } = new URL(request.url);
  if (BLOCKED_COMMERCIAL_CRAWLER.test(request.headers.get("user-agent") ?? "")) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
