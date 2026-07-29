import type { Route } from "next";

/**
 * Canonical asset href. Subassets live under their longname slug (`/asset/PARENT.child`) — the
 * numeric registered name redirects there — so every link that KNOWS the longname should emit it
 * directly and skip the hop. Longnames are case-sensitive and may contain `.`, `-`, `_`, `@`, `!`
 * (all path-safe once encoded); pass them exactly as stored, never case-folded.
 */
export function assetHref(asset: string, assetLongname?: string | null): Route {
  return `/asset/${encodeURIComponent(assetLongname || asset)}` as Route;
}
