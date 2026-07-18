"use client";
import Link from "next/link";
import useSWR from "swr";
import type { FeaturedAsset } from "@xcp/shared/assets";
import type { AssetEmergencePayload } from "@xcp/shared/radar";
import type { TradeRow } from "@xcp/shared/trades";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { useTrades } from "@/lib/hooks";
import { AssetArt } from "@/features/assets/components/asset-art";
import { ART_WIDTH } from "@/lib/art";
import { AssetIcon } from "@/components/ui/badges";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { SearchBox } from "@/components/chrome/search-box";
import { commas, short, timeAgo, usdCompact } from "@/lib/format";

type Scalar = string | number | null | undefined;
type LeaderboardRow = Record<string, Scalar>;
interface First {
  key: string;
  label: string;
  date: string;
}

const questions = [
  {
    eyebrow: "What’s good?",
    title: "Collections",
    body: "Browse the art, sets, and on-chain culture that endured.",
    href: "/collections",
    tone: "from-violet-500/15",
  },
  {
    eyebrow: "What’s emerging?",
    title: "Radar",
    body: "See where independent buyers and active trading days are forming an early market.",
    href: "/radar",
    tone: "from-sky-500/15",
  },
  {
    eyebrow: "Who’s real?",
    title: "Leaderboards",
    body: "See collectors, creators, and reputations derived from chain history.",
    href: "/leaderboards",
    tone: "from-emerald-500/15",
  },
  {
    eyebrow: "What happened first?",
    title: "Firsts",
    body: "Follow Counterparty’s origin story through verifiable milestones.",
    href: "/firsts",
    tone: "from-amber-500/15",
  },
] as const;

function AssetName({ asset, longname }: { asset: string; longname?: string | null }) {
  return (
    <Link href={`/asset/${asset}`} className="flex min-w-0 items-center gap-2">
      <AssetIcon asset={asset} size={24} />
      <span className="truncate">{longname || asset}</span>
    </Link>
  );
}

function saleValue(row: TradeRow) {
  if (row.usd_value != null) return usdCompact(row.usd_value);
  if (row.usd_estimate != null) return `\u2248${usdCompact(row.usd_estimate)}`;
  if (row.total != null)
    return `${row.total >= 1 ? commas(row.total.toFixed(2)) : row.total.toPrecision(3)} ${row.currency ?? ""}`.trim();
  return "—";
}

export function HomeDashboard() {
  const { rows: trades } = useTrades({}, 0, 5);
  const { data: featuredData } = useSWR<Envelope<FeaturedAsset[]>>(apiUrl("/v2/featured?limit=12"));
  const { data: radarData } = useSWR<Envelope<AssetEmergencePayload>>(apiUrl("/v2/radar/emergence"));
  const { data: leaderboardData } = useSWR<Envelope<Record<string, LeaderboardRow[]>>>(apiUrl("/v2/leaderboards"));
  const { data: firstsData } = useSWR<Envelope<First[]>>(apiUrl("/v2/firsts"));
  const featured = featuredData?.result ?? [];
  const radar = radarData?.result?.emerging.slice(0, 4) ?? [];
  const collectors = leaderboardData?.result?.top_collectors?.slice(0, 4) ?? [];
  const firsts = firstsData?.result?.slice(0, 4) ?? [];

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[radial-gradient(circle_at_top,#20242d_0%,#111318_42%,#09090b_100%)] px-5 py-8 text-center sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-(--color-xcp)">On Bitcoin since 2014</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-2xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
          The living history of Counterparty culture
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
          Rare Pepe, Bitcoin Stamps, card NFTs, and the collectors behind them — scored from the chain and open for
          anyone to verify.
        </p>
        <div className="mx-auto mt-6 hidden max-w-2xl sm:block">
          <SearchBox big />
        </div>
      </section>

      <section aria-labelledby="start-heading">
        <div className="mb-3">
          <h2 id="start-heading" className="text-base font-semibold text-zinc-100">
            Start with a question
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">Four ways into twelve years of on-chain history.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {questions.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className={`group rounded-xl border border-zinc-800 bg-gradient-to-br ${q.tone} to-zinc-950 p-4 !no-underline transition hover:-translate-y-0.5 hover:border-zinc-600`}
            >
              <div className="text-xs text-zinc-500">{q.eyebrow}</div>
              <div className="mt-1 flex items-center justify-between text-base font-semibold text-zinc-100">
                <span>{q.title}</span>
                <span className="text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-300">
                  →
                </span>
              </div>
              <p className="mt-2 text-sm leading-5 text-zinc-400">{q.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="grails-heading">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 id="grails-heading" className="text-base font-semibold text-zinc-100">
              Grails on-chain
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">High-quality assets with original art.</p>
          </div>
          <Link href="/collections" className="text-xs !text-zinc-400 hover:!text-zinc-100">
            Explore collections →
          </Link>
        </div>
        {featured.length === 0 ? (
          <Skeleton rows={2} />
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {featured.map((a) => (
              <Link
                key={a.asset}
                href={`/asset/${a.asset}`}
                title={a.asset_longname || a.asset}
                className="group min-w-0"
              >
                <AssetArt
                  asset={a.asset}
                  w={ART_WIDTH.thumbnail}
                  className="aspect-[5/7] w-full rounded-lg border border-zinc-800 transition group-hover:border-(--color-accent)"
                />
                <div className="mt-1 truncate text-[10px] text-zinc-500 group-hover:text-zinc-200">
                  {a.asset_longname || a.asset}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Radar — Emerging">
          <Link href="/radar" className="absolute right-4 top-4 text-xs !text-zinc-400">
            Full radar →
          </Link>
          {radar.length === 0 ? (
            <Skeleton rows={4} />
          ) : (
            <ol>
              {radar.map((r, i) => (
                <li key={r.asset} className="flex items-center gap-2 border-b border-zinc-900 py-2.5 last:border-0">
                  <span className="w-4 text-xs text-zinc-600">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <AssetName asset={r.asset} longname={r.asset_longname} />
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm text-(--color-xcp)">{r.market_formation}</div>
                    <div className="text-[9px] uppercase text-zinc-600">formation</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Top Collectors">
          <Link href="/leaderboards" className="absolute right-4 top-4 text-xs !text-zinc-400">
            All boards →
          </Link>
          {collectors.length === 0 ? (
            <Skeleton rows={4} />
          ) : (
            <ol>
              {collectors.map((r, i) => {
                const address = String(r.address ?? "");
                return (
                  <li
                    key={address}
                    className="flex items-center gap-2 border-b border-zinc-900 py-3 text-sm last:border-0"
                  >
                    <span className="w-4 text-xs text-zinc-600">{i + 1}</span>
                    <Link href={`/address/${address}`} className="min-w-0 flex-1 truncate font-mono">
                      {short(address)}
                    </Link>
                    <span className="font-mono text-xs text-zinc-400">{commas(r.assets_held)} held</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <Card title="Counterparty Firsts">
          <Link href="/firsts" className="absolute right-4 top-4 text-xs !text-zinc-400">
            Full timeline →
          </Link>
          {firsts.length === 0 ? (
            <Skeleton rows={4} />
          ) : (
            <ol>
              {firsts.map((r) => (
                <li key={r.key} className="border-b border-zinc-900 py-2.5 last:border-0">
                  <div className="flex gap-2 text-sm">
                    <time className="w-[4.8rem] shrink-0 font-mono text-xs text-zinc-500">{r.date}</time>
                    <span className="min-w-0 text-zinc-300">{r.label}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <section
        className="rounded-xl border border-zinc-800 bg-zinc-900/25 px-4 py-3"
        aria-labelledby="activity-heading"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id="activity-heading" className="text-sm font-semibold text-zinc-300">
            Activity now
          </h2>
          <Link href="/trades" className="text-xs !text-zinc-500">
            All trades →
          </Link>
        </div>
        {trades.length === 0 ? (
          <Skeleton rows={2} />
        ) : (
          <div className="grid gap-x-5 lg:grid-cols-5">
            {trades.map((r, i) => (
              <div
                key={r.tx_hash ?? i}
                className="flex min-w-0 items-center gap-2 border-t border-zinc-900 py-2 text-xs lg:block"
              >
                <div className="min-w-0 flex-1 truncate text-sm">
                  {r.asset ? <Link href={`/asset/${r.asset}`}>{r.asset}</Link> : "—"}
                </div>
                <div className="flex shrink-0 items-center justify-between gap-2 text-zinc-500 lg:mt-1">
                  <span className="font-mono text-zinc-300">{saleValue(r)}</span>
                  <span>{timeAgo(r.block_time)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
