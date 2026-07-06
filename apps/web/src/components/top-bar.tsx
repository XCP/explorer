"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { usePrices } from "@/lib/prices";
import { SearchBox } from "@/components/search-box";

const PRIMARY = [
  { label: "Assets", href: "/assets" },
  { label: "Trades", href: "/trades" },
  { label: "Blocks", href: "/blocks" },
  { label: "Transactions", href: "/transactions" },
  { label: "Leaderboards", href: "/leaderboards" },
  { label: "Firsts", href: "/firsts" },
  { label: "Vaults", href: "/vaults" },
];
const MORE: [string, string][] = [
  ["Sends", "/sends"], ["Issuances", "/issuances"], ["Orders", "/orders"], ["Matches", "/matches"],
  ["Dispensers", "/dispensers"], ["Dispenses", "/dispenses"], ["Sweeps", "/sweeps"], ["Broadcasts", "/broadcasts"],
  ["Dividends", "/dividends"], ["Burns", "/burns"], ["Fairminters", "/fairminters"], ["Fairmints", "/fairmints"],
  ["Destructions", "/destructions"], ["Bets", "/bets"], ["Exchanges", "/exchanges"], ["Network stats", "/stats"],
];

function Ticker({ label, v, chg }: { label: string; v: number | null; chg: number | null }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-xs text-zinc-300 font-mono">{v != null ? `$${v < 10 ? v.toFixed(2) : v.toLocaleString()}` : "—"}</span>
      {chg != null && <span className={`text-[10px] font-mono ${chg >= 0 ? "text-green-500" : "text-red-500"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>}
    </div>
  );
}

function WalletButton({ full = false }: { full?: boolean }) {
  return (
    <button
      onClick={() => { const w = (window as any).xcpwallet; if (w?.connect) w.connect().catch(() => {}); else window.open("https://www.xcp.io", "_blank"); }}
      className={`rounded text-xs font-medium bg-[--color-xcp] text-white hover:brightness-110 transition ${full ? "w-full py-2.5" : "px-3 py-1.5"}`}
    >
      Connect Wallet
    </button>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { btc, btcChange, xcp, xcpChange } = usePrices();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // "/" focuses the (desktop) search field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "/" && !typing) { e.preventDefault(); document.querySelector<HTMLInputElement>("[data-search] input")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setMenuOpen(false); }, [pathname]); // close drawer on navigation

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto flex items-center gap-3 sm:gap-5 px-4 py-2">
        <Link href="/" className="font-bold tracking-wider font-mono text-sm text-zinc-100 no-underline hover:!brightness-100 shrink-0">
          xcp<span className="text-[--color-xcp]">.io</span>
        </Link>

        {/* desktop nav */}
        <nav className="hidden sm:flex items-center gap-4 text-xs">
          {PRIMARY.map((l) => (
            <Link key={l.href} href={l.href} className={`!no-underline transition-colors ${active(l.href) ? "!text-zinc-100" : "!text-zinc-500 hover:!text-zinc-200"}`}>{l.label}</Link>
          ))}
          <div className="relative" onMouseLeave={() => setMoreOpen(false)}>
            <button onClick={() => setMoreOpen((o) => !o)} onMouseEnter={() => setMoreOpen(true)} className="text-zinc-500 hover:text-zinc-200 transition-colors">More ▾</button>
            {moreOpen && (
              <div className="absolute left-0 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-xl z-50 min-w-[16rem]">
                {MORE.map(([label, href]) => (
                  <Link key={href} href={href} className="!text-zinc-400 hover:!text-zinc-100 !no-underline text-xs py-0.5">{label}</Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* desktop search */}
        <div className="hidden sm:block ml-auto sm:ml-2 flex-1 max-w-md"><SearchBox autoFocusKey /></div>

        {/* desktop right */}
        <div className="hidden sm:flex items-center gap-4 shrink-0">
          <div className="hidden md:flex items-center gap-4"><Ticker label="BTC" v={btc} chg={btcChange} /><Ticker label="XCP" v={xcp} chg={xcpChange} /></div>
          <div className="h-4 w-px bg-zinc-800" />
          <WalletButton />
        </div>

        {/* mobile hamburger */}
        <button onClick={() => setMenuOpen((o) => !o)} aria-label="Menu"
          className="sm:hidden ml-auto flex items-center justify-center size-8 rounded border border-zinc-800 bg-zinc-900 text-zinc-300">
          <span className="text-base leading-none">{menuOpen ? "✕" : "≡"}</span>
        </button>
      </div>

      {/* mobile search row — always visible (search is the #1 mobile action) */}
      <div className="sm:hidden px-4 pb-2"><SearchBox big /></div>

      {/* mobile drawer — full nav, no functionality lost */}
      {menuOpen && (
        <div className="sm:hidden border-t border-zinc-800 bg-zinc-950 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4"><Ticker label="BTC" v={btc} chg={btcChange} /><Ticker label="XCP" v={xcp} chg={xcpChange} /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[...PRIMARY.map((p) => [p.label, p.href] as [string, string]), ...MORE].map(([label, href]) => (
              <Link key={href} href={href} className={`!no-underline py-2 ${active(href) ? "!text-zinc-100" : "!text-zinc-400"}`}>{label}</Link>
            ))}
          </div>
          <WalletButton full />
        </div>
      )}
    </header>
  );
}
