import type { Metadata } from "next";
import Link from "next/link";
import {
  Crown,
  ShieldCheck,
  Zap,
  UserRound,
  Clock,
  Hammer,
  Coins,
  Gift,
  Activity,
  Vault,
  ArrowDownToLine,
  Building2,
  Flame,
  Server,
  ArrowRight,
  Layers,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReputationTiersOverview } from "@xcp/shared/addresses";
import { getJson, type Envelope } from "@/lib/api/server";
import { commas } from "@/lib/format";

export const metadata: Metadata = {
  title: "Reputation",
  description:
    "On Counterparty there are no accounts — just Bitcoin wallets. Reputation scores every real wallet on twelve years of on-chain history and ranks it into four tiers. Here's how.",
};

// The signals that earn a score, ranked by weight (mirrors reputation/config.ts ADDRESS_FACTORS, grouped).
const FACTORS: { name: string; share: number; color: string; Icon: LucideIcon; desc: string; subs: string[] }[] = [
  {
    name: "Participation",
    share: 26,
    color: "#38bdf8",
    Icon: Activity,
    desc: "Skin across the protocol — XCP held, DEX orders matched, assets collected, Bitcoin Stamps created.",
    subs: ["XCP held", "DEX trades", "assets held", "stamps"],
  },
  {
    name: "Longevity",
    share: 22,
    color: "#22b8e6",
    Icon: Clock,
    desc: "A long on-chain life that's still active. Age is capped — being early isn't being reputable — and a sustained span counts for more.",
    subs: ["age", "active span"],
  },
  {
    name: "Real spend",
    share: 22,
    color: "#0ea5e9",
    Icon: Coins,
    desc: "Bitcoin actually put at risk — miner fees paid, BTC spent collecting, BTC earned dispensing. No faking it without spending.",
    subs: ["BTC fees", "BTC spent", "dispense revenue"],
  },
  {
    name: "Creating",
    share: 15,
    color: "#0284c7",
    Icon: Hammer,
    desc: "Assets it issued that found a real audience — ten or more holders, not a self-airdrop to sock puppets.",
    subs: ["surviving assets"],
  },
  {
    name: "Citizenship",
    share: 15,
    color: "#0369a1",
    Icon: Gift,
    desc: "Pro-holder, pro-protocol acts — dividends paid to holders, and supply locked so the asset can't be rugged.",
    subs: ["dividends paid", "locked supply"],
  },
];

const TIER: Record<string, { Icon: LucideIcon; width: string; fill: string; text: string; icon: string }> = {
  og: {
    Icon: Crown,
    width: "w-full sm:w-[42%]",
    fill: "bg-sky-500/15 ring-sky-400/40",
    text: "text-sky-200",
    icon: "text-sky-300",
  },
  established: {
    Icon: ShieldCheck,
    width: "w-full sm:w-[62%]",
    fill: "bg-teal-500/12 ring-teal-400/30",
    text: "text-teal-200",
    icon: "text-teal-300",
  },
  active: {
    Icon: Zap,
    width: "w-full sm:w-[81%]",
    fill: "bg-zinc-500/12 ring-zinc-500/50",
    text: "text-zinc-200",
    icon: "text-zinc-300",
  },
  casual: {
    Icon: UserRound,
    width: "w-full",
    fill: "bg-zinc-500/[.06] ring-zinc-700/60",
    text: "text-zinc-300",
    icon: "text-zinc-400",
  },
};

const CUT = { og: 16.33, est: 5.22, act: 2.88 };
const BIN_COLOR = (b: number) =>
  b >= CUT.og ? "#38bdf8" : b >= CUT.est ? "#2dd4bf" : b >= CUT.act ? "#a1a1aa" : "#52525b";
const bandLabel = (cumPct: number, isLast: boolean) =>
  isLast ? "Everyone else" : `Top ${cumPct < 1.5 ? 1 : Math.round(cumPct)}%`;

// Editorial section eyebrow + headline — big display type carries the story, not uniform card chrome.
function Movement({
  n,
  eyebrow,
  title,
  children,
}: {
  n: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border2)] pt-10">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-sm text-sky-400/70">{n}</span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{eyebrow}</span>
      </div>
      <h2 className="mt-2 max-w-[20ch] text-3xl font-semibold tracking-tight text-zinc-100 text-balance">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default async function ReputationPage() {
  const env = await getJson<Envelope<ReputationTiersOverview>>("/v2/reputation/tiers", { revalidate: 300 }).catch(
    () => null,
  );
  const d = env?.result;
  if (!d) return <p className="text-zinc-400">Reputation data is unavailable right now.</p>;
  const total = d.total || 1;
  const f = d.funnel;
  const grand = f.total_addresses || 1;
  const pct = (n: number) => ((100 * n) / total).toFixed(1);
  const bands = d.tiers.map((t, i) => {
    const running = d.tiers.slice(0, i + 1).reduce((sum, tier) => sum + tier.count, 0);
    return { ...t, band: bandLabel((100 * running) / total, i === d.tiers.length - 1) };
  });
  const hist = d.histogram ?? [];
  const maxBin = Math.max(1, ...hist.map((h) => h.count));

  const INFRA: [LucideIcon, string, number, string][] = [
    [Vault, "Emblem Vaults", f.by_kind.vaults, "wrapped-card custody"],
    [ArrowDownToLine, "Deposit addresses", f.by_kind.deposits, "exchange forwarders"],
    [Building2, "Exchanges", f.by_kind.exchanges, "custodial wallets"],
    [Flame, "Burn addresses", f.by_kind.burns, "unspendable sinks"],
    [Server, "Service hubs", f.by_kind.services, "high-traffic, never trade"],
  ];

  return (
    <div className="space-y-14 pb-8">
      {/* ── HERO ── */}
      <section className="relative isolate -mt-4 pt-16 pb-4 text-center">
        <div className="pointer-events-none absolute inset-x-0 -top-4 -z-10 h-72 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(56,189,248,0.13),transparent_70%)]" />
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-400/80">
          Counterparty reputation
        </div>
        <h1 className="mx-auto mt-4 max-w-[22ch] text-4xl font-semibold tracking-tight text-zinc-50 text-balance sm:text-5xl">
          Anyone can make a wallet. Trust has to be earned.
        </h1>
        <p className="mx-auto mt-5 max-w-[54ch] text-base leading-relaxed text-zinc-400 sm:text-lg">
          Counterparty runs on Bitcoin — no logins, no profiles, just addresses. So we score every real wallet on its
          full on-chain history and rank it. This is how a decade-long track record earns its place.
        </p>
      </section>

      {/* ── THE PYRAMID — hero centerpiece ── */}
      <section className="space-y-2">
        {bands.map((t) => {
          const m = TIER[t.slug] ?? TIER.casual;
          return (
            <Link
              key={t.slug}
              href={`/reputation/${t.slug}`}
              className={`group mx-auto flex items-center justify-between gap-4 rounded-xl px-6 py-4 ring-1 ring-inset transition-all duration-200 hover:ring-2 ${m.width} ${m.fill}`}
            >
              <span className="flex min-w-0 items-center gap-3.5">
                <m.Icon className={`size-6 shrink-0 ${m.icon}`} aria-hidden />
                <span className="min-w-0 leading-tight">
                  <span className={`block text-base font-semibold ${m.text}`}>{t.tier}</span>
                  <span className="block text-xs text-zinc-500">
                    {t.band} · {t.meaning}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-right leading-tight">
                <span className="block font-mono text-2xl font-semibold tabular-nums text-zinc-50">
                  {commas(t.count)}
                </span>
                <span className="block text-[11px] text-zinc-500">{pct(t.count)}% of users</span>
              </span>
            </Link>
          );
        })}
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 pt-4 font-mono text-xs text-zinc-500">
          <span>
            <span className="text-zinc-300">{commas(f.total_addresses)}</span> addresses seen
          </span>
          <span>
            <span className="text-zinc-300">{commas(f.scored)}</span> real users scored
          </span>
          <span>
            mean <span className="text-zinc-300">{d.mean}</span>
          </span>
          <span>
            top <span className="text-zinc-300">{d.max}</span>
          </span>
        </div>
      </section>

      {/* ── I · THE ENGINE ── */}
      <Movement n="I" eyebrow="What earns it" title="A wallet's rank is a weighted sum of five signals.">
        <div className="flex h-11 overflow-hidden rounded-lg ring-1 ring-inset ring-white/10">
          {FACTORS.map((x) => (
            <div
              key={x.name}
              style={{ width: `${x.share}%`, background: x.color }}
              className="flex items-center justify-center font-mono text-[11px] font-semibold text-white/95"
              title={`${x.name} · ${x.share}%`}
            >
              {x.share}%
            </div>
          ))}
        </div>
        <div className="mt-7 grid gap-x-10 gap-y-6 md:grid-cols-2">
          {FACTORS.map((x) => (
            <div key={x.name} className="flex gap-3.5">
              <x.Icon className="mt-1 size-5 shrink-0" style={{ color: x.color }} aria-hidden />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-semibold text-zinc-100">{x.name}</h3>
                  <span className="font-mono text-xs" style={{ color: x.color }}>
                    {x.share}%
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{x.desc}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {x.subs.map((s) => (
                    <span
                      key={s}
                      className="rounded bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 ring-1 ring-inset ring-white/5"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <div className="flex gap-3.5">
            <ShieldAlert className="mt-1 size-5 shrink-0 text-amber-400" aria-hidden />
            <div className="min-w-0">
              <h3 className="font-semibold text-zinc-100">And bad actors lose points</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                Three on-chain-provable demerits subtract from the score: cracking a vault then selling the empty shell,
                minting fake shells that name a real card, and dumping single high-supply units as $40
                &ldquo;collectibles.&rdquo;
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["vault cracking", "shell scams", "supply dumps"].map((s) => (
                  <span
                    key={s}
                    className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300/90 ring-1 ring-inset ring-amber-500/20"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Movement>

      {/* ── II · THE FILTER ── */}
      <Movement n="II" eyebrow="Who's eligible" title="But most addresses aren't people.">
        <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
          {/* the funnel — big numbers narrowing */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-zinc-400">Every address on Counterparty</span>
              <span className="font-mono text-xl tabular-nums text-zinc-300">{commas(f.total_addresses)}</span>
            </div>
            <div className="mt-2 h-3 w-full rounded bg-zinc-700/70" />
            <div className="py-3 text-center text-xs text-zinc-500">
              −{commas(f.infrastructure)} infrastructure
              <div className="mx-auto mt-1 h-4 w-px bg-zinc-700" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-sky-300">Real users, scored</span>
              <span className="font-mono text-3xl font-semibold tabular-nums text-sky-300">{commas(f.scored)}</span>
            </div>
            <div className="mt-2 h-3 rounded bg-sky-500" style={{ width: `${(100 * f.scored) / grand}%` }} />
          </div>
          {/* what got removed */}
          <div className="space-y-4">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Infrastructure, not people
              </div>
              <div className="mt-2 space-y-1.5">
                {INFRA.map(([Icon, label, n, gloss]) => (
                  <div key={label} className="flex items-center gap-2.5 text-sm">
                    <Icon className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
                    <span className="min-w-0 flex-1 text-zinc-300">
                      {label} <span className="text-zinc-600">— {gloss}</span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-zinc-400">{commas(n)}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="border-t border-zinc-900 pt-3 text-sm leading-relaxed text-zinc-500">
              There's no &ldquo;no-history&rdquo; bucket. If we have a row for an address, it did something on-chain —
              received, sent, minted, traded, dispensed, or paid a fee. Take away the infrastructure and everything left
              is a real user with a real record.
            </p>
          </div>
        </div>
      </Movement>

      {/* ── III · THE DISTRIBUTION ── */}
      <Movement n="III" eyebrow="The reality" title="Reputation is rare, and mostly low.">
        <p className="-mt-2 mb-5 max-w-[60ch] text-sm leading-relaxed text-zinc-400">
          Plotted by score, the population is a steep curve: almost every wallet clusters near the bottom, and
          reputation thins to a long tail. The four tiers are simply cutoffs on it.
        </p>
        <div className="relative h-40">
          <div className="absolute inset-0 flex items-end gap-px">
            {hist.map(({ bin, count }) => (
              <div
                key={bin}
                className="flex-1 rounded-t-[2px]"
                style={{
                  height: `${Math.max(2, (Math.sqrt(count) / Math.sqrt(maxBin)) * 100)}%`,
                  background: BIN_COLOR(bin),
                }}
                title={`score ${bin}${bin >= 40 ? "+" : ""} · ${commas(count)} wallets`}
              />
            ))}
          </div>
          {[CUT.act, CUT.est, CUT.og].map((x) => (
            <div key={x} className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: `${(x / 40) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-zinc-600">
          <span>score 0</span>
          <span>40+</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-400">
          {[
            ["Casual", "#52525b", "<2.9"],
            ["Active", "#a1a1aa", "≥2.9"],
            ["Established", "#2dd4bf", "≥5.2"],
            ["OG", "#38bdf8", "≥16.3"],
          ].map(([label, c, cut]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-[2px]" style={{ background: c }} />
              {label} <span className="text-zinc-600">{cut}</span>
            </span>
          ))}
        </div>
      </Movement>

      {/* ── IV · IN PRACTICE ── */}
      <Movement n="IV" eyebrow="Where it lives" title="You'll see it across the explorer.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/asset/PEPECASH"
            className="group rounded-xl border border-[#1a1d24] bg-[#101216] p-5 transition-colors hover:border-sky-500/30"
          >
            <div className="flex items-center gap-2.5">
              <Layers className="size-4 text-sky-400" aria-hidden />
              <h3 className="font-semibold text-zinc-100">On asset pages</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              The Holder view breaks any asset&apos;s cap table down by tier — a token held by OGs reads very
              differently from one held by fresh Casual wallets.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm text-sky-400">
              See it on PEPECASH{" "}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
          <Link
            href="/reputation/og"
            className="group rounded-xl border border-[#1a1d24] bg-[#101216] p-5 transition-colors hover:border-sky-500/30"
          >
            <div className="flex items-center gap-2.5">
              <Crown className="size-4 text-sky-400" aria-hidden />
              <h3 className="font-semibold text-zinc-100">On address pages</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Every wallet leads with its tier and score, backed by the evidence — the assets it created, the BTC it
              spent, the dividends it paid.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm text-sky-400">
              Meet the OG wallets{" "}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        </div>
      </Movement>
    </div>
  );
}
