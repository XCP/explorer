import type { Metadata } from "next";
import Link from "next/link";
import type { RatingsOverview } from "@xcp/shared/assets";
import type { Envelope } from "@xcp/shared/envelope";
import { getJson } from "@/lib/api/server";
import { commas, timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Asset Ratings",
  description: "How XCP.io rates the demonstrated market record of Counterparty assets.",
};

const SCALE = [
  ["9.0–10.0", "Exceptional breadth, duration, and realized market value."],
  ["7.0–8.9", "Substantial evidence across all three rating dimensions."],
  ["4.0–6.9", "Developing market record with meaningful but uneven evidence."],
  ["0.0–3.9", "Limited eligible market evidence relative to rated assets."],
] as const;

export default async function RatingsPage() {
  const envelope = await getJson<Envelope<RatingsOverview>>("/v2/ratings", { revalidate: 3600 }).catch(() => null);
  const data = envelope?.result;
  const distribution = data?.distribution ?? [];
  const maxCount = Math.max(1, ...distribution.map((row) => row.count));

  return (
    <main className="mx-auto max-w-5xl space-y-12 pb-16">
      <header className="border-b border-[var(--border2)] pb-8 pt-6">
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">XCP.io methodology</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-100">Asset Ratings</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
          One literal Rating from 0.0 to 10.0 summarizes an asset&apos;s demonstrated historical market record. A higher
          Rating means stronger evidence across independent buyers, active market months, and realized value.
        </p>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 font-mono text-sm text-zinc-400">
          <span>
            <strong className="text-zinc-100">{commas(data?.population ?? 0)}</strong> rated assets
          </span>
          <span>
            <strong className="text-zinc-100">v{data?.model_version ?? 1}</strong> model
          </span>
          {data?.calculated_at ? (
            <span>
              refreshed <strong className="text-zinc-100">{timeAgo(data.calculated_at)}</strong>
            </span>
          ) : null}
        </div>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">The Rating</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          Each input is converted to its percentile within the eligible population. The three percentiles receive equal
          weight, and the combined result is ranked once more. An 8.2 Rating means the asset&apos;s combined market
          record is at approximately the 82nd percentile. It is not an 82% probability of appreciation.
        </p>
        <div className="mt-6 divide-y divide-[var(--border2)] border-y border-[var(--border2)]">
          {SCALE.map(([range, meaning]) => (
            <div key={range} className="grid gap-2 py-4 sm:grid-cols-[8rem_1fr]">
              <div className="font-mono font-semibold text-zinc-100">{range}</div>
              <div className="text-sm text-zinc-400">{meaning}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">What goes into it</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            ["Independent buyers", "Distinct known buyers purchasing from a different known seller."],
            ["Active months", "Distinct calendar months containing an eligible completed sale."],
            ["Realized value", "Total USD consideration at trade time across eligible direct-sale venues."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
              <div className="font-semibold text-zinc-100">{title}</div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
              <div className="mt-4 font-mono text-xs text-zinc-500">33⅓% of the Rating</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">Current distribution</h2>
        <p className="mt-2 text-sm text-zinc-500">Rated population grouped by the nearest whole-number Rating.</p>
        <div className="mt-6 space-y-2">
          {distribution.map((row) => (
            <div key={row.rating} className="grid grid-cols-[2rem_1fr_5rem] items-center gap-3">
              <div className="font-mono text-sm text-zinc-300">{row.rating}</div>
              <div className="h-5 overflow-hidden rounded-sm bg-zinc-900">
                <div
                  className="h-full bg-sky-500/70"
                  style={{ width: `${Math.max(1, (100 * row.count) / maxCount)}%` }}
                />
              </div>
              <div className="text-right font-mono text-xs text-zinc-500">{commas(row.count)}</div>
            </div>
          ))}
        </div>
      </section>

      {data?.examples?.length ? (
        <section>
          <h2 className="text-xl font-semibold text-zinc-100">Across the scale</h2>
          <div className="mt-5 grid gap-x-8 border-y border-[var(--border2)] sm:grid-cols-2">
            {data.examples.map((row) => (
              <Link
                key={row.asset}
                href={`/asset/${encodeURIComponent(row.asset)}`}
                className="flex items-center justify-between border-b border-[var(--border2)] py-3 !text-zinc-300"
              >
                <span className="truncate">{row.asset_longname ?? row.asset}</span>
                <span className="font-mono text-zinc-100">{row.rating.toFixed(1)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-5 border-t border-[var(--border2)] pt-8 text-sm leading-6 text-zinc-400">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Eligibility and integrity</h2>
          <p className="mt-2">
            Eligible evidence requires a completed direct sale with known, different buyer and seller identities. Self
            trades, invalid transactions, per-asset bundle allocations, and cracked, empty-shell, or classified
            dump-vault sales do not contribute. Assets under a reviewed integrity classification are shown as
            <strong className="text-zinc-300"> Not rated — integrity flag</strong>.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Why Ratings change</h2>
          <p className="mt-2">
            Ratings refresh daily. A Rating can change when an asset gains buyers, trades in a new month, realizes more
            eligible value, or when the comparison population changes. The Rating is therefore a current assessment of
            accumulated evidence, not a permanent certificate. This page reports the model version and calculation time
            so changes remain auditable.
          </p>
        </div>
        <p className="text-zinc-500">
          Rating summarizes historical market evidence. It is not authentication, artistic judgment, a price target, or
          an investment recommendation.
          {data?.calculated_at
            ? ` Current distribution calculated ${new Date(data.calculated_at * 1000).toLocaleDateString("en-US", { dateStyle: "long" })}.`
            : ""}
        </p>
      </section>
    </main>
  );
}
