import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "USD Value Methodology",
  description: "How XCP.io reconstructs historical USD payment values without filling gaps with false precision.",
};

const SOURCES = [
  ["BTC/USD", "Coinbase daily market observations, supplemented by reviewed CoinMarketCap history."],
  ["XCP/USD", "Direct historical observations, reconstructed venue history, and reviewed aggregate history."],
  [
    "Collection currencies",
    "Exact-day CMC observations and reviewed one-hop paths through XCP, BTC, JPY, or dispensers.",
  ],
  ["USDC payments", "Direct dollar-denominated consideration at parity."],
] as const;

export default function UsdMethodologyPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-12 pb-16">
      <header className="border-b border-[var(--border2)] pb-8 pt-6">
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">XCP.io methodology</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-100">Historical USD values</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-400">
          A displayed USD value estimates the consideration paid at the time of a completed trade. It is not
          today&apos;s value, an appraisal of the asset, or a promise that the same price was available elsewhere. When
          the evidence is not strong enough, XCP.io leaves USD blank instead of extending a stale price indefinitely.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">What we currently cover</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ["195,333", "completed DEX matches shown"],
            ["164,143", "DEX matches with USD"],
            ["31,190", "DEX matches left without USD"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
              <div className="font-mono text-2xl font-semibold text-zinc-100">{value}</div>
              <div className="mt-2 text-sm text-zinc-400">{label}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-500">
          With reviewed low-quality assets hidden, the DEX population is 148,282 matches: 137,620 have USD and 10,662
          remain unpriced. Counts are a point-in-time coverage audit dated July 19, 2026 and will move as new trades
          arrive.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">What the quality control changes</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          The default trade view excludes a row when either DEX asset is flagged, a dispenser bundle contains a flagged
          asset, or an Emblem sale is classified as a dump, empty shell, or cracked vault. The toggle restores the rows;
          it does not change their recorded transaction amounts.
        </p>
        <div className="mt-5 divide-y divide-[var(--border2)] border-y border-[var(--border2)] text-sm">
          {[
            ["DEX", "47,051 excluded", "$19.25M excluded", "Mostly DIAMONDBOND, VACUS, TROPTIONS, and NVST."],
            ["Dispensers", "44,151 excluded", "$648.56M excluded", "Mostly OXBT, ORDIPEPE, and OGPASS."],
            [
              "Emblem",
              "90,007 excluded",
              "$2.97M excluded",
              "89,279 classified dump-vault sales dominate the count, not the value.",
            ],
          ].map(([venue, count, value, note]) => (
            <div key={venue} className="grid gap-1 py-4 sm:grid-cols-[7rem_8rem_9rem_1fr]">
              <strong className="text-zinc-200">{venue}</strong>
              <span className="font-mono text-zinc-300">{count}</span>
              <span className="font-mono text-zinc-300">{value}</span>
              <span className="text-zinc-500">{note}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">The selection policy</h2>
        <div className="mt-5 divide-y divide-[var(--border2)] border-y border-[var(--border2)]">
          {[
            [
              "Match the day",
              "Use the UTC execution day. A current quote is never substituted for a historical payment.",
            ],
            ["Prefer direct evidence", "Direct USD and established BTC/XCP conversions outrank indirect paths."],
            ["Limit derivation", "Reviewed collection-currency conversions use at most one market bridge before USD."],
            [
              "Require agreement",
              "Where independent paths overlap, severe disagreement is rejected rather than resolved by convenient source priority.",
            ],
            [
              "Keep provenance",
              "Selected prices retain source, observed day, policy version, derivation depth, activity, and disagreement metadata.",
            ],
            [
              "Allow null",
              "Missing evidence is a result. Null is preferable to a precise-looking number produced by stale or recursive conversion.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-2 py-4 sm:grid-cols-[11rem_1fr]">
              <div className="font-medium text-zinc-200">{title}</div>
              <p className="text-sm leading-6 text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">Price evidence</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {SOURCES.map(([title, body]) => (
            <div key={title} className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
              <div className="font-semibold text-zinc-100">{title}</div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">Why gaps remain</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          Counterparty markets are sparse and asynchronous. Some assets traded only against another thin asset; some
          quote currencies have multi-year price gaps; some same-day paths disagree materially; and some activity is
          classified as wash-like, scam, dump, or otherwise low quality. Connectivity alone does not establish a dollar
          scale. Chaining lifetime exchange ratios can make nearly every connected trade produce a number, but our
          sensitivity test inflated the remaining clean population from roughly $1.1M under indefinite nearest-anchor
          carry to $48.7M under unrestricted graph propagation. That instability is evidence against publishing it.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">Research behind the choices</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          The policy follows market-microstructure findings rather than treating every print as interchangeable.
          Nonsynchronous trading research shows that stale observations distort measured returns and relationships;
          crypto price-discovery research separates information leadership from venue noise; and wash-trading research
          supports transaction-structure and identity evidence instead of price-only filters.
        </p>
        <ul className="mt-5 space-y-2 text-sm text-zinc-400">
          <li>
            <a href="https://www.nber.org/papers/w2960" target="_blank" rel="noreferrer">
              Lo &amp; MacKinlay — Nonsynchronous Trading ↗
            </a>
          </li>
          <li>
            <a href="https://eprints.lse.ac.uk/100410/" target="_blank" rel="noreferrer">
              Makarov &amp; Schoar — Price Discovery in Cryptocurrency Markets ↗
            </a>
          </li>
          <li>
            <a
              href="https://www.sciencedirect.com/science/article/pii/S1386418120300537"
              target="_blank"
              rel="noreferrer"
            >
              Dimpfl &amp; Peter — Price Discovery and Noise Across Crypto Exchanges ↗
            </a>
          </li>
          <li>
            <a href="https://arxiv.org/abs/2311.18717" target="_blank" rel="noreferrer">
              Falk, Tsoukalas &amp; Zhang — NFT Wash Trading ↗
            </a>
          </li>
          <li>
            <a
              href="https://docs.cfbenchmarks.com/CME%20CF%20Reference%20Rates%20Methodology.pdf"
              target="_blank"
              rel="noreferrer"
            >
              CME CF Cryptocurrency Reference Rates Methodology ↗
            </a>
          </li>
        </ul>
      </section>

      <section className="border-t border-[var(--border2)] pt-8 text-sm leading-6 text-zinc-400">
        <h2 className="text-lg font-semibold text-zinc-100">How to read the trades page</h2>
        <p className="mt-2 max-w-3xl">
          The trade count includes completed transactions even when USD is unknown. “Known volume” sums only rows with
          admitted historical USD evidence. The quality control hides flagged assets and classified Emblem scam or dump
          sales by default; turning it on exposes those records without admitting them into the clean view.
        </p>
        <Link href="/trades" className="mt-4 inline-block font-medium">
          View all trades →
        </Link>
      </section>
    </main>
  );
}
