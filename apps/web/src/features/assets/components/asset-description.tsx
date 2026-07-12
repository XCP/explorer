"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { AssetEnhanced } from "@xcp/shared/assets";
import { apiUrl } from "@/lib/api/url";

// The sanitizer and JSON renderer are only needed after an explicit inspect action. Keeping this
// as a separate client chunk avoids charging every asset-page visit for an uncommon tool.
const AssetEnhancedInfo = dynamic(() =>
  import("@/features/assets/components/asset-enhanced-info").then((m) => m.AssetEnhancedInfo)
);

const MAX = 220;
// A JSON pointer per CIP-25 (a .json URL; legacy @/​* prefixes). External-media protocols get an inspect link.
const isJsonPointer = (d: string) => /\.json(\?|#|$)/i.test(d) || d.toLowerCase().includes(".json") || /^[@*]https?:\/\//i.test(d);

function externalInspect(d: string): string | null {
  const lower = d.toLowerCase().trim();
  if (lower.startsWith("ipfs:")) return `https://ipfs.io/ipfs/${d.trim().slice(5).replace(/^\/\//, "")}`;
  if (lower.startsWith("ord:")) {
    try {
      const bin = atob(d.trim().slice(4).trim());
      let hex = Array.from(bin, (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      if (!hex.endsWith("i0")) hex += "i0";
      return `https://ordinals.com/inscription/${hex}`;
    } catch { return null; }
  }
  return null;
}

/**
 * The asset's on-chain description with a CIP-25 inspector. If the description points to a JSON file we show an
 * Inspect button that loads it through our server proxy (/enhanced — CORS-free, size-capped, ;sha256-verified)
 * and renders the Enhanced Asset Info. ipfs:/ord: descriptions get a direct inspect link instead.
 */
export function AssetDescription({ asset, description }: { asset: string; description: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<AssetEnhanced | null>(null);
  if (!description) return null;

  // stamp:/ord:/data: descriptions are raw on-chain IMAGE BYTES, not text — the art already renders in the
  // plate, so we show a compact label instead of dumping a giant base64 blob into the layout.
  const binaryKind = /^stamp:/i.test(description.trim()) ? "On-chain STAMP image"
    : /^ord:/i.test(description.trim()) ? "Ordinals inscription"
    : /^data:/i.test(description.trim()) ? "Inline data URI" : null;
  const json = isJsonPointer(description);
  const ext = externalInspect(description);
  const long = description.length > MAX;
  const shown = expanded || !long ? description : description.slice(0, MAX) + "…";

  const load = async () => {
    setState("loading");
    try {
      const res = await fetch(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/enhanced`), {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Enhanced asset API ${res.status}`);
      const env = await res.json() as { result: AssetEnhanced | null };
      setResult(env.result);
      setState(env.result && !env.result.error && env.result.json ? "done" : "error");
    } catch { setState("error"); }
  };

  return (
    <div className="card factcard">
      {/* Title row with the inspect action inline on the right (only when the description is inspectable). */}
      <div className="flex items-center justify-between gap-3">
        <h2>Description</h2>
        {json && state === "idle" && (
          <button onClick={load} className="cursor-pointer rounded-md bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-inset ring-sky-500/20 hover:bg-sky-500/20">
            Inspect JSON
          </button>
        )}
        {state === "loading" && <span className="text-xs text-zinc-500">Loading…</span>}
        {ext && (
          <a href={ext} target="_blank" rel="noopener noreferrer" className="cursor-pointer rounded-md bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-inset ring-sky-500/20 hover:bg-sky-500/20">
            Inspect ↗
          </a>
        )}
      </div>
      <div className="body">
        {binaryKind ? (
          <p className="text-sm text-zinc-400">{binaryKind}<span className="ml-1 text-zinc-600">· {description.length.toLocaleString()} bytes on-chain</span></p>
        ) : (
          // [overflow-wrap:anywhere] force-breaks unbroken tokens (long URLs, base64) so nothing overflows.
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed text-zinc-300">
            {shown}
            {long && <button onClick={() => setExpanded((e) => !e)} className="ml-2 cursor-pointer whitespace-nowrap text-xs text-sky-400 hover:text-sky-300">{expanded ? "less" : "more"}</button>}
          </p>
        )}
        {state === "error" && <p className="mt-2 text-xs text-red-400">{result?.error || "Could not load the JSON."}</p>}
        {state === "done" && result?.json && <AssetEnhancedInfo data={result.json} verified={result.verified} onClose={() => { setState("idle"); setResult(null); }} />}
      </div>
    </div>
  );
}
