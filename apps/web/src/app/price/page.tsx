import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import type { PriceCandles, PricePage } from "@xcp/shared/prices";
import { getJson, type Envelope } from "@/lib/api/server";
import {
  SectionHeader,
  SectionIdentity,
  SectionStats,
  SectionChip,
  type SectionStat,
} from "@/components/section-header";
import { PriceHistoryChart } from "@/features/price/components/price-history-chart";
import { TradingViewPriceChart } from "@/features/price/components/tradingview-price-chart";
import { PriceCandlesChart } from "@/features/price/components/price-candles-chart";
import { commas } from "@/lib/format";

// The XCP price, explained — the asset-page anatomy applied to a number: the plate is the
// twelve-year chart, the factcards say exactly HOW the number is made and what on-chain evidence
// stands behind it. This is the page the header ticker links to; both read the same calendar that
// values every trade on the site.
export const metadata: Metadata = {
  title: "XCP price — Counterparty price history",
  description:
    "The explorer's own XCP price: twelve years of daily history with full provenance — genesis burns, on-chain DEX and dispenser executions, and observed aggregates, ranked by fidelity.",
};

const usd = (v: number) =>
  v >= 100 ? `$${Math.round(v).toLocaleString("en-US")}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;

const SOURCE_STORY: Record<string, { name: string; note: string }> = {
  burn_vwm: {
    name: "Genesis burns",
    note: "protocol BTC→XCP conversions — the only price that existed before markets",
  },
  market_vwm: {
    name: "On-chain market",
    note: "volume-weighted median over DEX order matches + dispenser executions, × BTC/USD",
  },
  market_vwm_thin: {
    name: "On-chain market (thin)",
    note: "same cross-rate on a day below the liquidity floor — only ever fills otherwise-unpriced days",
  },
  dex_vwm: { name: "On-chain DEX", note: "superseded by the combined on-chain market edge" },
  coinmarketcap_aggregate: {
    name: "CMC aggregate",
    note: "observed multi-exchange daily aggregates (historical import)",
  },
  zaif_vwm: {
    name: "Zaif XCP/JPY",
    note: "first-party yen executions × the official ECB cross — the best-measured source (0.032 median error)",
  },
  dextrade_xcpbtc_spot: {
    name: "Dex-Trade spot",
    note: "latest CEX XCP/BTC execution × Coinbase BTC/USD (last-resort live quote)",
  },
  coinbase_spot: { name: "Coinbase spot", note: "intraday BTC/USD ticker" },
};

export default async function PricePageRoute() {
  const [env, ohlcEnv] = await Promise.all([
    getJson<Envelope<PricePage>>(`/v2/price`, { revalidate: 300 }),
    // The tape is additive — a failed fetch hides the section rather than failing the page.
    getJson<Envelope<PriceCandles>>(`/v2/price/ohlc`, { revalidate: 3600 }).catch(() => null),
  ]);
  const page = env.result;
  if (!page?.xcp) throw new Error("price unavailable");
  const candles = ohlcEnv?.result?.candles ?? [];
  const sats = page.sats ? Math.round(page.sats.price_btc * 1e8) : null;

  const stats: SectionStat[] = [
    {
      label: "XCP",
      value: usd(page.xcp.usd),
      detail: page.change_pct != null ? `${page.change_pct > 0 ? "+" : ""}${page.change_pct}% 24h` : undefined,
    },
    ...(sats ? [{ label: "On-chain", value: `${commas(sats)} sats`, detail: `last edge ${page.sats!.day}` }] : []),
    ...(page.ath ? [{ label: "All-time high", value: usd(page.ath.usd), detail: page.ath.day }] : []),
    ...(page.btc ? [{ label: "BTC", value: usd(page.btc.usd), detail: page.btc.source.replace("_", " ") }] : []),
  ];

  const overview = (
    <>
      {/* Full-width hero: the chart owns the row; USD / in-BTC / vs-BTC modes live inside it. */}
      <div className="plate">
        <div className="bg-[#0e1218] p-3">
          <PriceHistoryChart history={page.history} />
        </div>
        <div className="cap">
          <span>
            <b>XCP</b> · daily since {page.history[0]?.day.slice(0, 4)} · log scale
          </span>
          <span>{commas(page.history.length)} days</span>
        </div>
      </div>
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">Interactive chart</h2>
        <div className="plate">
          <div className="bg-[#0e1218] p-2">
            <TradingViewPriceChart history={page.history} />
          </div>
          <div className="cap">
            <span>
              <b>TradingView</b> · xcp.io daily closes
            </span>
            <span>drag to pan · scroll to zoom</span>
          </div>
        </div>
        <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-zinc-500">
          Powered by TradingView Lightweight Charts. This uses the explorer&apos;s provenance-backed XCP series—not a
          discontinued exchange pair. Bars show attributable executed XCP volume on days where venue data exists.
        </p>
      </section>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="card factcard">
          <h2>How this number is made</h2>
          <div className="body">
            <div className="row">
              <span className="k">Today</span>
              <span className="amt mono">
                {SOURCE_STORY[page.xcp.source]?.name ?? page.xcp.source}
                <span className="time"> {page.xcp.day}</span>
              </span>
            </div>
            <div className="row">
              <span className="k">Kind</span>
              <span className="amt mono">{page.xcp.price_kind}</span>
            </div>
            {page.xcp.observed_day && page.xcp.observed_day !== page.xcp.day && (
              <div className="row">
                <span className="k">Observed</span>
                <span className="amt mono">{page.xcp.observed_day}</span>
              </div>
            )}
            <div className="row">
              <span className="k">Policy</span>
              <span className="amt mono">
                fidelity-ranked <span className="time">observed beats derived</span>
              </span>
            </div>
          </div>
        </div>
        <div className="card factcard">
          <h2>On-chain evidence · 30d</h2>
          <div className="body">
            {page.venues_30d.length === 0 && (
              <div className="row">
                <span className="k">Executions</span>
                <span className="amt mono">none this month</span>
              </div>
            )}
            {page.venues_30d.map((venue) => (
              <div className="row" key={venue.venue}>
                <span className="k">{venue.venue === "dex" ? "DEX matches" : "Dispenses"}</span>
                <span className="amt mono">
                  {commas(venue.fills)} <span className="time">{commas(venue.volume_xcp)} XCP</span>
                </span>
              </div>
            ))}
            <div className="row">
              <span className="k">Self-fills</span>
              <span className="amt mono">
                excluded <span className="time">buyer = seller never counts</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <SectionHeader flush>
        <SectionIdentity
          visual={<img className="icon" src="https://cdn.xcp.io/img/icon/XCP" alt="" />}
          name="XCP price"
          chips={
            <>
              <SectionChip variant="neutral" href={"/asset/XCP" as Route}>
                the asset
              </SectionChip>
              <SectionChip variant="neutral" href={"/year" as Route}>
                the yearbook
              </SectionChip>
            </>
          }
        />
        <SectionStats stats={stats} />
      </SectionHeader>

      {overview}

      {candles.length > 1 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">The on-chain tape</h2>
          <div className="plate">
            <div className="bg-[#0e1218] p-3">
              <PriceCandlesChart candles={candles} />
            </div>
            <div className="cap">
              <span>
                <b>XCP/BTC</b> · candles from on-chain executions only — DEX matches + dispenser fills, self-fills
                excluded
              </span>
              <span>
                {commas(candles.reduce((sum, candle) => sum + candle.fills, 0))} fills · {commas(candles.length)} traded
                days
              </span>
            </div>
          </div>
          <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
            Every candle is built from real executions on Bitcoin — no exchange feed. The close is that day&apos;s
            volume-weighted median, the same edge the calendar consumes; the wicks span the volume-weighted 5–95% of
            fill prices, so a single mispriced dispenser triggering for dust reads as dispersion, not as a fantasy high.
            This market is thin — read the volume row before reading the candles. Days with no executions are gaps,
            honestly.
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">Source eras</h2>
        <div className="card">
          <div className="body">
            {page.sources.map((era) => (
              <div className="row" key={era.source}>
                <span className="k">{SOURCE_STORY[era.source]?.name ?? era.source}</span>
                <span className="amt mono">
                  {era.first_day} → {era.last_day} <span className="time">{commas(era.days)} days</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
          Every day since the genesis burn carries exactly one XCP/USD value, selected by a fidelity-ranked policy:
          directly observed aggregates outrank derived cross-rates, and a daily close outranks an intraday spot. The
          on-chain edge — a volume-weighted median over DEX order matches <i>and</i> dispenser executions, with literal
          self-fills excluded — prices XCP in BTC from the chain itself; only the BTC/USD conversion comes from outside.
          If every external feed went dark tomorrow, the chain-native price would keep printing. This same calendar
          values every trade on this site — the number in the header is the number in the ledger.{" "}
          <Link href={"/asset/XCP" as Route}>See XCP the asset →</Link>
        </p>
      </section>
    </>
  );
}
