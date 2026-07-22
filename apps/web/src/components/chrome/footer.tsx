import Link from "next/link";
import type { Route } from "next";
import { SyncStatus } from "@/components/chrome/sync-status";

// Brand/about column, four navigation columns, and a live sync line. The footer stays server-rendered;
// SyncStatus is its only client island.
type FooterLink = [label: string, href: Route | `https://${string}`];

const EXPLORE: FooterLink[] = [
  ["Assets", "/assets"],
  ["Trades", "/trades"],
  ["Blocks", "/blocks"],
  ["Mempool", "/mempool"],
  ["All records", "/transactions"],
];
const DISCOVER: FooterLink[] = [
  ["Collections", "/collections"],
  ["Leaderboards", "/leaderboards"],
  ["Firsts", "/firsts"],
  ["Vaults", "/vaults"],
  ["Recover Bitcoin", "/recovery"],
  ["Exchanges", "/exchanges"],
  ["Network Stats", "/stats"],
];
const ECOSYSTEM: FooterLink[] = [
  ["xcpdex", "https://xcpdex.com"],
  ["Digirare", "https://digirare.com"],
  ["XCP Wallet", "https://xcp.io"],
  ["counterparty.io", "https://counterparty.io"],
  ["GitHub", "https://github.com/CounterpartyXCP"],
];
const DATA: FooterLink[] = [
  ["USD methodology", "/usd-methodology"],
  ["API", "https://api.xcp.io"],
  ["IMG CDN", "https://cdn.xcp.io"],
  ["GitHub repo", "https://github.com/XCP/explorer"],
];

const linkClass = "text-xs !text-zinc-400 hover:!text-(--color-accent) !no-underline";

function Column({ heading, links }: { heading: string; links: FooterLink[] }) {
  return (
    <div>
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{heading}</h3>
      <ul className="space-y-1.5">
        {links.map(([label, href]) =>
          href.startsWith("http") ? (
            <li key={href}>
              <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {label}&nbsp;↗
              </a>
            </li>
          ) : (
            <li key={href}>
              <Link href={href as Route} className={linkClass}>
                {label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-[#0c0c0e] mt-12">
      <div className="max-w-[1200px] mx-auto px-4 py-10 space-y-8">
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-1">
            <div className="text-sm font-bold tracking-wider font-mono text-zinc-100">
              XCP<span className="text-(--color-brand)">.io</span>
            </div>
            <p className="mt-2.5 max-w-[34ch] text-xs leading-relaxed text-zinc-400">
              The reference explorer for Counterparty — the unified sales ledger, reputation intelligence, and twelve
              years of provenance on Bitcoin.
            </p>
          </div>
          <Column heading="Explore" links={EXPLORE} />
          <Column heading="Discover" links={DISCOVER} />
          <Column heading="Ecosystem" links={ECOSYSTEM} />
          <Column heading="Data" links={DATA} />
        </nav>
        <div className="flex flex-col gap-3 border-t border-zinc-900 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <SyncStatus />
          <span className="text-xs text-zinc-400">Counterparty blockchain explorer — on Bitcoin since 2014.</span>
        </div>
      </div>
    </footer>
  );
}
