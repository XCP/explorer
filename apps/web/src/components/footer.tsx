import Link from "next/link";

// Family-consistent footer (mirrors xcpdex): brand + tagline left, sibling/ecosystem links right.
export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 px-4 py-4 mt-8">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-wider font-mono">xcp<span className="text-[--color-xcp]">.io</span></span>
          <span className="text-[11px] text-zinc-500">Counterparty blockchain explorer</span>
        </div>
        <nav className="flex items-center gap-4 text-[11px] text-zinc-500">
          <a href="https://xcpdex.com" target="_blank" rel="noopener noreferrer" className="!text-zinc-500 hover:!text-zinc-300">Exchange ↗</a>
          <a href="https://digirare.com" target="_blank" rel="noopener noreferrer" className="!text-zinc-500 hover:!text-zinc-300">Digirare ↗</a>
          <a href="https://github.com/CounterpartyXCP" target="_blank" rel="noopener noreferrer" className="!text-zinc-500 hover:!text-zinc-300">GitHub ↗</a>
          <a href="https://counterparty.io" target="_blank" rel="noopener noreferrer" className="!text-zinc-500 hover:!text-zinc-300">Docs ↗</a>
        </nav>
      </div>
    </footer>
  );
}
