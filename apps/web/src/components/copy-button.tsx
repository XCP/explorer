"use client";
import { useState } from "react";

// Copy-to-clipboard pill. Tiny client island so the surrounding header can stay server-rendered.
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  return (
    <button onClick={copy} className="shrink-0 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-1.5 py-0.5">
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}
