"use client";
import { trackEvent } from "@/lib/fathom";

/** The asset page's outbound actions — the site's true conversions (we're the knowledge layer;
 *  the doing happens on xcpdex/Digirare). Client island purely so the clicks can be counted. */
export function AssetActions({ asset }: { asset: string }) {
  return (
    <>
      <a
        href={`https://xcpdex.com/${asset}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn2"
        onClick={() => trackEvent("outbound: trade on xcpdex")}
      >
        Trade on xcpdex ↗
      </a>
      <a
        href={`https://digirare.com/cards/${encodeURIComponent(asset)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn2 primary"
        onClick={() => trackEvent("outbound: collect on digirare")}
      >
        Collect ↗
      </a>
    </>
  );
}
