import type { Metadata } from "next";
import Link from "next/link";
import type { ReputationTiersOverview } from "@xcp/shared/addresses";
import type { Envelope } from "@xcp/shared/envelope";
import { getJson } from "@/lib/api/server";
import { commas, timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Address Reputation",
  description: "How XCP.io summarizes the observed Counterparty track record of user-like Bitcoin addresses.",
};

const FAMILIES = [
  ["Duration", "Observed span between the address's first and latest Counterparty activity."],
  ["Creation", "Assets that found an audience, dividends paid, and locked asset supply."],
  ["Economic", "Bitcoin fees plus clean BTC spent collecting and earned through dispensers."],
  ["Participation", "Current collecting breadth, completed DEX matches, and Bitcoin Stamps created."],
] as const;

const SCALE = [
  ["99–100", "Exceptional", "Top 1% of ranked addresses."],
  ["90–98.9", "Strong", "Next 9% of ranked addresses."],
  ["50–89.9", "Established", "Upper half of ranked addresses."],
  ["0–49.9", "Limited", "Limited evidence relative to ranked addresses."],
] as const;

export default async function ReputationPage() {
  const envelope = await getJson<Envelope<ReputationTiersOverview>>("/v2/reputation/tiers", {
    revalidate: 3600,
  }).catch(() => null);
  const data = envelope?.result;
  if (!data) return <p className="text-zinc-400">Reputation data is unavailable right now.</p>;
  const distribution = data.histogram ?? [];
  const maxCount = Math.max(1, ...distribution.map((row) => row.count));

  return (
    <main className="mx-auto max-w-5xl space-y-12 pb-16">
      <header className="border-b border-[var(--border2)] pb-8 pt-6">
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">XCP.io methodology</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-100">Address Reputation</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
          Reputation is a 0–100 relative rank of an address&apos;s directly observed Counterparty track record. A higher
          number means broader and more substantial historical evidence—not a more trustworthy owner.
        </p>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 font-mono text-sm text-zinc-400">
          <span>
            <strong className="text-zinc-100">{commas(data.total)}</strong> ranked addresses
          </span>
          <span>
            <strong className="text-zinc-100">v{data.model_version}</strong> model
          </span>
          {data.calculated_at ? (
            <span>
              refreshed <strong className="text-zinc-100">{timeAgo(data.calculated_at)}</strong>
            </span>
          ) : null}
        </div>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">What Reputation claims</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          It answers: <em>How substantial and sustained is this address&apos;s observed Counterparty track record?</em> It
          does not predict future activity, verify identity, measure honesty, or endorse an address. Exact last activity
          is shown separately and never changes the accumulated Reputation through an arbitrary recency cutoff.
        </p>
        <div className="mt-6 divide-y divide-[var(--border2)] border-y border-[var(--border2)]">
          {SCALE.map(([range, label, meaning]) => (
            <Link
              key={range}
              href={`/reputation/${label.toLowerCase()}`}
              className="grid gap-2 py-4 !text-zinc-300 sm:grid-cols-[8rem_9rem_1fr]"
            >
              <span className="font-mono font-semibold text-zinc-100">{range}</span>
              <span className="font-medium text-zinc-200">{label}</span>
              <span className="text-sm text-zinc-400">{meaning}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">What goes into it</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          Heavy-tailed inputs are log-transformed within four evidence families. Each family becomes a percentile among
          eligible addresses, receives equal weight, and the combined evidence is ranked once more.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {FAMILIES.map(([title, body]) => (
            <div key={title} className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
              <div className="font-semibold text-zinc-100">{title}</div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
              <div className="mt-4 font-mono text-xs text-zinc-500">25% of Reputation</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-100">Current distribution</h2>
        <p className="mt-2 text-sm text-zinc-500">Ranked population grouped by whole-number Reputation.</p>
        <div className="mt-6 space-y-1.5">
          {distribution.map((row) => (
            <div key={row.bin} className="grid grid-cols-[2.5rem_1fr_5rem] items-center gap-3">
              <div className="font-mono text-sm text-zinc-300">{row.bin}</div>
              <div className="h-4 overflow-hidden rounded-sm bg-zinc-900">
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

      <section className="space-y-5 border-t border-[var(--border2)] pt-8 text-sm leading-6 text-zinc-400">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Who is classified instead</h2>
          <p className="mt-2">
            Exchanges, exchange deposits, Emblem Vault custody addresses, burn addresses, service hubs, and addresses
            with directly evidenced integrity incidents do not receive a numeric Reputation. They receive the factual
            classification instead. Current counts include {commas(data.funnel.by_kind.exchanges)} exchanges, {" "}
            {commas(data.funnel.by_kind.deposits)} deposits, {commas(data.funnel.by_kind.vaults)} vaults, {" "}
            {commas(data.funnel.by_kind.burns)} burns, and {commas(data.funnel.by_kind.services)} services.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Why Reputation changes</h2>
          <p className="mt-2">
            Reputation refreshes daily. It can change when an address accumulates evidence or when the comparison
            population changes. Population ranks replace fixed block-height bonuses, decay boundaries, and manually
            calibrated score anchors.
          </p>
        </div>
        <p className="text-zinc-500">
          Reputation summarizes public on-chain history. It is not identity verification, a safety guarantee, an
          endorsement, or an investment recommendation.
        </p>
      </section>
    </main>
  );
}
