import Link from "next/link";

// Chrome footer: brand + tagline, an internal-nav echo of the primary IA, and the ecosystem links
// (family-consistent with xcpdex). The API is a product surface — it gets a link.
const INTERNAL: [string, string][] = [
  ["Assets", "/assets"],
  ["Trades", "/trades"],
  ["Blocks", "/blocks"],
  ["Leaderboards", "/leaderboards"],
  ["Network Stats", "/stats"],
];
const ECOSYSTEM: [string, string][] = [
  ["API", "https://xcp-api.me-bbe.workers.dev"],
  ["Exchange", "https://xcpdex.com"],
  ["Digirare", "https://digirare.com"],
  ["GitHub", "https://github.com/CounterpartyXCP"],
  ["Docs", "https://counterparty.io"],
];

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 px-4 py-5 mt-8">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-wider font-mono">xcp<span className="text-[--color-xcp]">.io</span></span>
          <span className="text-[11px] text-zinc-500">Counterparty blockchain explorer</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px]">
          {INTERNAL.map(([label, href]) => (
            <Link key={href} href={href} className="!text-zinc-500 hover:!text-zinc-300 !no-underline">{label}</Link>
          ))}
          <span aria-hidden="true" className="h-3 w-px bg-zinc-800" />
          {ECOSYSTEM.map(([label, href]) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="!text-zinc-500 hover:!text-zinc-300 !no-underline">{label}&nbsp;↗</a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
