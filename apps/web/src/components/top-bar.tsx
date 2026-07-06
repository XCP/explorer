"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { usePrices } from "@/lib/prices";
import { SearchBox } from "@/components/search-box";
import { NavMenu, type NavGroup } from "@/components/nav-menu";

/**
 * Navigation IA — positions ranked by user intent:
 *   1 Assets (the catalog)  2 Trades (the market)  3 Blocks (the chain timeline)
 *   4 Records ▾ (the 16 protocol feeds, grouped)   5 Discover ▾ (curated/insight surfaces)
 * Transactions is a raw feed reached from blocks/search — it lives in Records, not primary.
 */
const PRIMARY: [string, string][] = [
  ["Assets", "/assets"],
  ["Trades", "/trades"],
  ["Blocks", "/blocks"],
];
const RECORDS: NavGroup[] = [
  { heading: "Transfers", links: [["Sends", "/sends"], ["Sweeps", "/sweeps"], ["Dispenses", "/dispenses"]] },
  { heading: "Trading", links: [["Orders", "/orders"], ["Matches", "/matches"], ["Dispensers", "/dispensers"], ["BTCPays", "/btcpays"], ["Bets", "/bets"]] },
  { heading: "Issuance", links: [["Issuances", "/issuances"], ["Fairminters", "/fairminters"], ["Fairmints", "/fairmints"], ["Dividends", "/dividends"], ["Destructions", "/destructions"], ["Burns", "/burns"]] },
  { heading: "Chain", links: [["Transactions", "/transactions"], ["Broadcasts", "/broadcasts"]] },
];
const DISCOVER: NavGroup[] = [
  { links: [["Mempool", "/mempool"], ["Leaderboards", "/leaderboards"], ["Firsts", "/firsts"], ["Vaults", "/vaults"], ["Exchanges", "/exchanges"], ["Network Stats", "/stats"]] },
];

function Ticker({ label, v, chg }: { label: string; v: number | null; chg: number | null }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-xs text-zinc-300 font-mono tabular-nums">{v != null ? `$${v < 10 ? v.toFixed(2) : v.toLocaleString()}` : "—"}</span>
      {chg != null && <span className={`text-[10px] font-mono tabular-nums ${chg >= 0 ? "text-green-500" : "text-red-500"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>}
    </div>
  );
}

function WalletButton({ full = false }: { full?: boolean }) {
  return (
    <button
      onClick={() => { const w = (window as { xcpwallet?: { connect?: () => Promise<void> } }).xcpwallet; if (w?.connect) w.connect().catch(() => {}); else window.open("https://www.xcp.io", "_blank"); }}
      className={`rounded text-xs font-medium bg-[--color-xcp] text-white hover:brightness-110 transition ${full ? "w-full py-2.5" : "px-3 py-1.5"}`}
    >
      Connect Wallet
    </button>
  );
}

export function TopBar() {
  const pathname = usePathname();
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
  // Escape closes the mobile drawer
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto flex items-center gap-3 sm:gap-5 px-4 py-2">
        <Link href="/" className="font-bold tracking-wider font-mono text-sm text-zinc-100 no-underline hover:!brightness-100 shrink-0">
          xcp<span className="text-[--color-xcp]">.io</span>
        </Link>

        {/* desktop nav */}
        <nav aria-label="Primary" className="hidden sm:flex items-center gap-4 text-xs">
          {PRIMARY.map(([label, href]) => (
            <Link key={href} href={href} className={`!no-underline transition-colors ${active(href) ? "!text-zinc-100" : "!text-zinc-500 hover:!text-zinc-200"}`}>{label}</Link>
          ))}
          <NavMenu label="Records" id="nav-records" groups={RECORDS} />
          <NavMenu label="Discover" id="nav-discover" groups={DISCOVER} />
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
        <button onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen} aria-controls="mobile-menu"
          className="sm:hidden ml-auto flex items-center justify-center size-8 rounded border border-zinc-800 bg-zinc-900 text-zinc-300">
          <span aria-hidden="true" className="text-base leading-none">{menuOpen ? "✕" : "≡"}</span>
        </button>
      </div>

      {/* mobile search row — always visible (search is the #1 mobile action) */}
      <div className="sm:hidden px-4 pb-2"><SearchBox big /></div>

      {/* mobile drawer — the same IA as desktop: primary row, then the grouped catalogs */}
      {menuOpen && (
        <nav id="mobile-menu" aria-label="Primary" className="sm:hidden border-t border-zinc-800 bg-zinc-950 px-4 py-3 space-y-4 max-h-[70vh] overflow-y-auto overscroll-contain">
          <div className="flex items-center gap-4"><Ticker label="BTC" v={btc} chg={btcChange} /><Ticker label="XCP" v={xcp} chg={xcpChange} /></div>
          <div className="flex gap-2">
            {PRIMARY.map(([label, href]) => (
              <Link key={href} href={href} className={`flex-1 text-center rounded border px-2 py-2 !no-underline text-sm ${active(href) ? "border-zinc-600 !text-zinc-100 bg-zinc-900" : "border-zinc-800 !text-zinc-400"}`}>{label}</Link>
            ))}
          </div>
          {[{ title: "Records", groups: RECORDS }, { title: "Discover", groups: DISCOVER }].map(({ title, groups }) => (
            <div key={title}>
              <div className="pb-1 text-[10px] uppercase tracking-wider text-zinc-600">{title}</div>
              <div className="grid grid-cols-2 gap-x-4">
                {groups.flatMap((g) => g.links).map(([label, href]) => (
                  <Link key={href} href={href} className={`!no-underline py-1.5 text-sm ${active(href) ? "!text-zinc-100" : "!text-zinc-400"}`}>{label}</Link>
                ))}
              </div>
            </div>
          ))}
          <WalletButton full />
        </nav>
      )}
    </header>
  );
}
