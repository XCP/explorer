import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Big_Shoulders } from "next/font/google";
import type { YearIndex } from "@xcp/shared/years";
import { getJson, type Envelope } from "@/lib/api/server";
import { FULL_BLEED } from "@/components/section-header";
import { YearSparkNav, usdShort } from "@/features/years/components/year-charts";
import { commas } from "@/lib/format";

// The yearbook's cover — /year is the table of contents for /year/[year]. Same design system as
// the chapters (the .yr world: Big Shoulders numerals, kickers, bands), reading top-to-bottom as
// the whole arc: every spread is one year, its editorial title, its records, and three numbers.
const bigShoulders = Big_Shoulders({ weight: "700", subsets: ["latin"], variable: "--font-big-shoulders" });

export const metadata: Metadata = {
  title: "Counterparty Unwrapped — the yearbook",
  description:
    "Every year of Counterparty since 2014, told from the mirror itself: the burn, the mania, the ghost town, the rediscovery — every number computed from the chain.",
};

const RECORD_LABELS: Record<string, string> = {
  transactions: "most transactions",
  actors: "most active addresses",
  newcomers: "most first-timers",
  new_assets: "most assets minted",
  dex_fills_raw: "most DEX fills",
  clean_usd: "most USD settled",
};

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : v}%`;

export default async function YearbookCover() {
  const env = await getJson<Envelope<YearIndex>>(`/v2/years`, { revalidate: 3600 });
  const index = env.result;
  if (!index) throw new Error("year index unavailable");
  const years = index.years;
  const last = years[years.length - 1]!;

  return (
    <div className={`yr ${bigShoulders.variable} ${FULL_BLEED} !mb-0 bg-[#0b0e13]`}>
      <header className="pt-16 pb-0">
        <div className="yr-in">
          <div className="flex justify-between gap-4 flex-wrap yr-kicker !mb-0">
            <span>xcp.io · counterparty unwrapped</span>
            <span>
              2014 — {last.year}
              {last.partial ? " · in progress" : ""}
            </span>
          </div>
          <h1 className="display yr-year">The Yearbook</h1>
          <div className="display yr-sub">Counterparty, year by year</div>
          <p className="yr-lede" style={{ fontSize: 17.5 }}>
            Thirteen years of the original token protocol, told from the chain itself. It opens with{" "}
            <b>2,125.6 BTC destroyed in a month</b> to mint every XCP that will ever exist, peaks twice — the 2017 mania
            and the 2021 rediscovery, <b>the all-time record for value settled</b> — nearly dies in the 2020 ghost town,
            and keeps reinventing its venues: order books, vending machines, vaults, AMMs. Every number on every page is
            computed from the mirror; nothing is quoted from memory.
          </p>
          <YearSparkNav years={years} active={0} />
        </div>
      </header>

      <section className="yr-band">
        <div className="yr-in">
          <div className="yr-kicker">
            <span>table of contents</span>
            <span className="rule" />
          </div>
          <div className="mt-8 flex flex-col">
            {years.map((year) => (
              <Link
                key={year.year}
                href={`/year/${year.year}` as Route}
                className="group grid grid-cols-[92px_1fr] items-baseline gap-x-5 gap-y-1 border-t border-white/8 py-5 !no-underline sm:grid-cols-[110px_1fr_auto]"
              >
                <span className="display text-[42px] leading-none text-[color:var(--t3)] transition-colors group-hover:text-[color:var(--t1)] sm:text-[52px]">
                  {year.year}
                </span>
                <span className="min-w-0">
                  <span className="display block text-[22px] leading-tight text-[color:var(--t1)] sm:text-[26px]">
                    {year.title}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {year.partial && <span className="yr-record !m-0">◇ in progress</span>}
                    {year.records.map((key) => (
                      <span key={key} className="yr-record !m-0">
                        ◆ {RECORD_LABELS[key] ?? key}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="col-span-2 mt-1 flex gap-5 font-mono text-[12.5px] tabular-nums text-[color:var(--t3)] sm:col-span-1 sm:mt-0 sm:flex-col sm:items-end sm:gap-0.5 sm:text-right">
                  <span>
                    {usdShort(year.clean_usd)} <span className="text-[color:var(--t4)]">settled</span>
                  </span>
                  <span>
                    {commas(year.new_assets)} <span className="text-[color:var(--t4)]">minted</span>
                  </span>
                  {year.xcp && (
                    <span className={year.xcp.change_pct >= 0 ? "grn" : "text-[color:var(--t3)]"}>
                      {pct(year.xcp.change_pct)} <span className="text-[color:var(--t4)]">XCP</span>
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="yr-band">
        <div className="yr-in pb-16">
          <div className="yr-kicker">
            <span>colophon</span>
            <span className="rule" />
          </div>
          <p className="yr-lede">
            Figures are computed live from the xcp.io Counterparty mirror: raw tapes are shown as they printed (minus
            literal self-fills), and <b>clean</b> means wash-flagged assets are excluded. Completed years are frozen;
            the current year updates as blocks arrive.
          </p>
        </div>
      </section>
    </div>
  );
}
