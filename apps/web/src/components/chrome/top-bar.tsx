"use client";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { SearchBox } from "@/components/chrome/search-box";
import { NavMenu, type NavGroup } from "@/components/chrome/nav-menu";
import { StatusStrip } from "@/components/chrome/status-strip";

/**
 * Global chrome (v3 direction, design-lab v11): deliberately SIMPLE — the identity burden lives in
 * each section's contextual header, not here. Structure: status strip (chain left / market right),
 * then one slim row: XCP.io wordmark · Assets · Trades · Blocks · Explore ▾ · Discover ▾ · search ·
 * Connect. Tickers live in the strip, not this row.
 */
const PRIMARY: [string, Route][] = [
  ["Assets", "/assets"],
  ["Collections", "/collections"],
  ["Radar", "/radar"],
  ["Leaderboards", "/leaderboards"],
  ["Firsts", "/firsts"],
  ["Trades", "/trades"],
];
const EXPLORE: NavGroup[] = [
  {
    heading: "Transfers",
    links: [
      ["Sends", "/sends"],
      ["Sweeps", "/sweeps"],
      ["Dispenses", "/dispenses"],
    ],
  },
  {
    heading: "Trading",
    links: [
      ["Orders", "/orders"],
      ["Matches", "/matches"],
      ["Dispensers", "/dispensers"],
      ["BTCPays", "/btcpays"],
      ["Bets", "/bets"],
    ],
  },
  {
    heading: "Issuance",
    links: [
      ["Issuances", "/issuances"],
      ["Fairminters", "/fairminters"],
      ["Fairmints", "/fairmints"],
      ["Dividends", "/dividends"],
      ["Destructions", "/destructions"],
      ["Burns", "/burns"],
    ],
  },
  {
    heading: "Chain",
    links: [
      ["Transactions", "/transactions"],
      ["Broadcasts", "/broadcasts"],
    ],
  },
];
const DISCOVER: NavGroup[] = [
  {
    links: [
      ["Mempool", "/mempool"],
      ["Reputation", "/reputation"],
      ["Vaults", "/vaults"],
      ["Recover Bitcoin", "/recovery"],
      ["Exchanges", "/exchanges"],
      ["Blocks", "/blocks"],
      ["Network Stats", "/stats"],
    ],
  },
];

function WalletButton({ full = false }: { full?: boolean }) {
  return (
    <button
      onClick={() => {
        const w = (window as { xcpwallet?: { connect?: () => Promise<void> } }).xcpwallet;
        if (w?.connect) w.connect().catch(() => {});
        else window.open("https://xcp.io", "_blank");
      }}
      className={`rounded-md text-[13px] font-semibold bg-(--color-xcp) text-white hover:brightness-110 transition ${full ? "w-full py-2.5" : "px-3.5 py-1.5"}`}
    >
      Connect
    </button>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const setMenuOpen = (value: boolean) => setMenuPath(value ? pathname : null);
  // Primary sections match their singular detail routes too: /asset/X lights Assets, /trade… Trades,
  // /block/N Blocks (the plural href is itself covered by the singular prefix).
  const SECTION_PREFIX: Record<string, string> = { "/assets": "/asset", "/trades": "/trade", "/blocks": "/block" };
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(SECTION_PREFIX[href] ?? href);

  // "/" focuses the (desktop) search field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-search] input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Escape closes the mobile drawer
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPath(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <StatusStrip />
      {/* solid bg on purpose: backdrop blur rasterizes the header text and reads fuzzy on Windows */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950">
        <div className="max-w-[1200px] mx-auto flex items-center gap-3 sm:gap-5 px-4 py-[10px]">
          <Link
            href="/"
            className="font-bold tracking-wider font-mono text-[15px] text-zinc-100 no-underline hover:!brightness-100 shrink-0"
          >
            XCP<span className="text-(--color-xcp)">.io</span>
          </Link>

          {/* desktop nav — quiet pills; the interesting header is the section's, not this one */}
          <nav aria-label="Primary" className="hidden sm:flex items-center gap-1 text-[13px] font-medium">
            {PRIMARY.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className={`!no-underline rounded-md px-[11px] py-1.5 transition-colors ${active(href) ? "!text-zinc-100 bg-zinc-900" : "!text-zinc-400 hover:!text-zinc-100"}`}
              >
                {label}
              </Link>
            ))}
            <NavMenu label="Explore" id="nav-explore" groups={EXPLORE} />
            <NavMenu label="Discover" id="nav-discover" groups={DISCOVER} />
          </nav>

          {/* desktop search */}
          <div className="hidden sm:block ml-auto flex-1 max-w-sm xl:max-w-md">
            <SearchBox autoFocusKey />
          </div>

          {/* desktop right */}
          <div className="hidden sm:block shrink-0">
            <WalletButton />
          </div>

          {/* mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="sm:hidden ml-auto flex items-center justify-center size-8 rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300"
          >
            <span aria-hidden="true" className="text-base leading-none">
              {menuOpen ? "✕" : "≡"}
            </span>
          </button>
        </div>

        {/* mobile search row — always visible (search is the #1 mobile action) */}
        <div className="sm:hidden px-4 pb-2">
          <SearchBox big />
        </div>

        {/* mobile drawer — same IA as desktop: primary row, then the grouped catalogs */}
        {menuOpen && (
          <nav
            id="mobile-menu"
            aria-label="Primary"
            className="sm:hidden border-t border-zinc-800 bg-zinc-950 px-4 py-3 space-y-4 max-h-[70vh] overflow-y-auto overscroll-contain"
          >
            <div className="grid grid-cols-3 gap-2">
              {PRIMARY.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex-1 text-center rounded-md border px-2 py-2 !no-underline text-sm ${active(href) ? "border-zinc-600 !text-zinc-100 bg-zinc-900" : "border-zinc-800 !text-zinc-400"}`}
                >
                  {label}
                </Link>
              ))}
            </div>
            {[
              { title: "Explore", groups: EXPLORE },
              { title: "Discover", groups: DISCOVER },
            ].map(({ title, groups }) => (
              <div key={title}>
                <div className="pb-1 text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
                <div className="grid grid-cols-2 gap-x-4">
                  {groups
                    .flatMap((g) => g.links)
                    .map(([label, href]) => (
                      <Link
                        key={href}
                        href={href}
                        className={`!no-underline py-1.5 text-sm ${active(href) ? "!text-zinc-100" : "!text-zinc-400"}`}
                      >
                        {label}
                      </Link>
                    ))}
                </div>
              </div>
            ))}
            <WalletButton full />
          </nav>
        )}
      </header>
    </>
  );
}
