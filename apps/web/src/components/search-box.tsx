"use client";
import { useRouter } from "next/navigation";
import { useState, useRef } from "react";

// Shape-routing search shared by the nav and the home hero: 64-hex -> tx, digits -> block,
// address-like -> address, else -> asset.
export function SearchBox({ big = false, autoFocusKey = false }: { big?: boolean; autoFocusKey?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  function go(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim(); if (!v) return;
    if (/^[0-9a-fA-F]{64}$/.test(v)) router.push(`/tx/${v}`);
    else if (/^\d+$/.test(v)) router.push(`/block/${v}`);
    else if (/^(bc1|tb1|[123mn2])[a-km-zA-HJ-NP-Z1-9]{20,}$/.test(v)) router.push(`/address/${v}`);
    else router.push(`/asset/${v.toUpperCase()}`);
    setQ(""); ref.current?.blur();
  }
  return (
    <form onSubmit={go} className="relative w-full" data-search={autoFocusKey ? "" : undefined}>
      {/* lens LEFT, "/" affordance RIGHT (v11): the icon reads as part of the prompt, not a button */}
      <button type="submit" aria-label="Search" className={`absolute top-1/2 -translate-y-1/2 text-zinc-500 hover:text-[--color-accent] ${big ? "left-3.5" : "left-3"}`}>
        <svg aria-hidden="true" className={big ? "size-5" : "size-4"} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      </button>
      <input
        ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
        name="q" autoComplete="off" spellCheck={false} enterKeyHint="search"
        aria-label="Search asset, address, transaction, or block"
        placeholder="Search assets, addresses, txs, blocks…"
        className={`w-full rounded-md bg-[#101216] border border-zinc-800 text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-[--color-accent] ${
          big ? "pl-10 pr-4 py-3 text-base" : "pl-9 pr-9 py-[7px] text-[13px]"
        }`}
      />
      {autoFocusKey && !big && !q && (
        <kbd aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-zinc-800 px-1.5 font-mono text-[10px] leading-4 text-zinc-500">/</kbd>
      )}
    </form>
  );
}
