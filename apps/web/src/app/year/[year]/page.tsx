import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Big_Shoulders } from "next/font/google";
import type { YearIndex, YearPage, YearSummary } from "@xcp/shared/years";
import { getJson, NotFoundError, type Envelope } from "@/lib/api/server";
import { FULL_BLEED } from "@/components/section-header";
import { YearPriceChart } from "@/features/years/components/year-price-chart";
import { YearMonthColumns, YearRows, YearSparkNav, usdShort } from "@/features/years/components/year-charts";
import { artUrl, ART_WIDTH } from "@/lib/art";
import { collectionLabel, commas } from "@/lib/format";

// The yearbook numerals — loaded only on /year pages; .yr .display consumes the variable.
const bigShoulders = Big_Shoulders({ weight: "700", subsets: ["latin"], variable: "--font-big-shoulders" });

const VENUE_LABELS: Record<string, { name: string; sub: string }> = {
  dex: { name: "The DEX", sub: "the original venue" },
  dispense: { name: "Dispensers", sub: "on-chain BTC vending" },
  emblem: { name: "Emblem Vault", sub: "wrapped cards on Ethereum" },
  "scarce.city": { name: "Scarce City", sub: "Bitcoin auctions" },
  telegram: { name: "Telegram OTC", sub: "trust trades, recorded" },
  tokenly_swapbot: { name: "Tokenly Swapbot", sub: "the first vending era" },
};

const RECORD_LABELS: Record<string, string> = {
  transactions: "most transactions ever",
  actors: "most active addresses ever",
  newcomers: "most first-time addresses ever",
  new_assets: "most assets minted ever",
  dex_fills_raw: "most DEX fills ever",
  clean_usd: "most attributed USD ever settled",
};

async function loadYear(year: string): Promise<{ page: YearPage; index: YearIndex } | null> {
  try {
    const [pageEnv, indexEnv] = await Promise.all([
      getJson<Envelope<YearPage>>(`/v2/years/${year}`, { revalidate: 3600 }),
      getJson<Envelope<YearIndex>>(`/v2/years`, { revalidate: 3600 }),
    ]);
    if (!pageEnv.result || !indexEnv.result) return null;
    return { page: pageEnv.result, index: indexEnv.result };
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  const loaded = await loadYear(year);
  if (!loaded) return { title: `${year} — Counterparty Unwrapped` };
  return {
    title: `${loaded.page.year} · ${loaded.page.editorial.title} — Counterparty Unwrapped`,
    description: loaded.page.editorial.angle,
  };
}

/** Markdown-lite for editorial strings: **bold** only. */
function editorialText(text: string) {
  return text.split(/\*\*/).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
}

function heroStats(page: YearPage, summary: YearSummary) {
  const xcp = page.scoreboard.xcp;
  return [
    xcp
      ? {
          className: "chain",
          value: `${xcp.change_pct > 0 ? "+" : ""}${Math.abs(xcp.change_pct) >= 100 ? Math.round(xcp.change_pct).toLocaleString("en-US") : xcp.change_pct}%`,
          label: `XCP, ${usdShortPrice(xcp.open)} → ${usdShortPrice(xcp.close)}`,
        }
      : null,
    { className: "money", value: usdShort(page.stats.clean_usd), label: "attributed USD settled" },
    { className: "", value: commas(page.stats.new_assets), label: "assets minted" },
    {
      className: "",
      value: `${page.stats.newcomer_pct}%`,
      label: `of ${commas(page.stats.actors)} addresses were new`,
    },
  ].filter(Boolean) as { className: string; value: string; label: string }[];
}

const usdShortPrice = (v: number) => (v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);

export default async function YearPageRoute({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const loaded = await loadYear(year);
  if (!loaded) notFound();
  const { page, index } = loaded;
  const summary = index.years.find((row) => row.year === page.year);
  if (!summary) notFound();
  const previous = index.years.find((row) => row.year === page.year - 1);
  const next = index.years.find((row) => row.year === page.year + 1);

  const settlementInteresting =
    page.settlement.length > 1 && (page.settlement[1]?.fills ?? 0) >= (page.settlement[0]?.fills ?? 1) * 0.1;
  const monthlyUsd = page.monthly.map((month) => month.clean_usd);
  let chapter = 0;
  const kicker = (name: string) => `${String(++chapter).padStart(2, "0")} · ${name}`;

  return (
    <div className={`yr ${bigShoulders.variable} ${FULL_BLEED} !mb-0 bg-[#0b0e13]`}>
      {/* ---- hero ---- */}
      <header className="pt-16 pb-0">
        <div className="yr-in">
          <div className="flex justify-between gap-4 flex-wrap yr-kicker !mb-0">
            <span>xcp.io · year in review</span>
            <span>
              {page.partial ? `in progress · as of ${new Date(page.as_of * 1000).toISOString().slice(0, 10)}` : "final"}
            </span>
          </div>
          <h1 className="display yr-year">{page.year}</h1>
          <div className="display yr-sub">{page.editorial.title}</div>
          <p className="yr-lede" style={{ fontSize: 17.5 }}>
            {editorialText(page.editorial.angle)}
          </p>
          {summary.records.map((key) => (
            <span key={key} className="yr-record">
              ◆ record year · {RECORD_LABELS[key] ?? key}
            </span>
          ))}
          <YearSparkNav years={index.years} active={page.year} />
          <div className="yr-stats mb-16">
            {heroStats(page, summary).map((stat) => (
              <div key={stat.label} className={`yr-stat ${stat.className}`}>
                <div className="display v">{stat.value}</div>
                <div className="l">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ---- the burn (2014's founding chapter — leads when the payload carries it) ---- */}
      {page.burn && (
        <section className="yr-band">
          <div className="yr-in">
            <div className="yr-kicker">
              <span>{kicker("the burn")}</span>
              <span className="rule" />
            </div>
            <h2 className="display">Born by destruction</h2>
            <p className="yr-lede">
              Between <b>{page.burn.first_day}</b> and <b>{page.burn.last_day}</b>, <b>{commas(page.burn.burners)}</b>{" "}
              addresses sent <b>{commas(page.burn.btc_burned)} BTC</b> to an address nobody can spend from —{" "}
              <span className="font-mono">1CounterpartyXXXXXXXXXXXXXXXUWLpVr</span> — and received{" "}
              <b className="grn">{commas(page.burn.xcp_earned)} XCP</b>. No premine, no sale: the entire supply was
              bought with provable destruction, and every XCP that has ever existed traces back to these{" "}
              {commas(page.burn.burns)} burns.
            </p>
            <div className="yr-stats">
              <div className="yr-stat money">
                <div className="display v">{commas(page.burn.btc_burned)}</div>
                <div className="l">BTC destroyed, forever</div>
              </div>
              <div className="yr-stat chain">
                <div className="display v">{usdShort(page.burn.xcp_earned).replace("$", "")}</div>
                <div className="l">XCP born ({commas(page.burn.xcp_earned)})</div>
              </div>
              <div className="yr-stat">
                <div className="display v">{commas(page.burn.burners)}</div>
                <div className="l">burners — the founding cohort</div>
              </div>
              <div className="yr-stat">
                <div className="display v">
                  {Math.round((Date.parse(page.burn.last_day) - Date.parse(page.burn.first_day)) / 86_400_000) + 1}
                </div>
                <div className="l">days the window was open</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---- the price ---- */}
      {page.xcp_daily.length > 1 && page.scoreboard.xcp && (
        <section className="yr-band">
          <div className="yr-in">
            <div className="yr-kicker">
              <span>{kicker("the price")}</span>
              <span className="rule" />
            </div>
            <h2 className="display">
              {usdShortPrice(page.scoreboard.xcp.open)} to {usdShortPrice(page.scoreboard.xcp.high)}
            </h2>
            <p className="yr-lede">
              XCP opened at <b>{usdShortPrice(page.scoreboard.xcp.open)}</b>, touched{" "}
              <b>{usdShortPrice(page.scoreboard.xcp.high)}</b>, and closed at{" "}
              <b>{usdShortPrice(page.scoreboard.xcp.close)}</b>
              {page.scoreboard.btc && (
                <>
                  {" "}
                  —{" "}
                  {page.scoreboard.xcp.change_pct >= page.scoreboard.btc.change_pct ? (
                    <b className="grn">
                      outrunning Bitcoin&apos;s {page.scoreboard.btc.change_pct > 0 ? "+" : ""}
                      {Math.round(page.scoreboard.btc.change_pct)}%
                    </b>
                  ) : (
                    <>
                      while Bitcoin did {page.scoreboard.btc.change_pct > 0 ? "+" : ""}
                      {Math.round(page.scoreboard.btc.change_pct)}%
                    </>
                  )}
                </>
              )}
              .
              {page.scoreboard.pepecash && (
                <>
                  {" "}
                  PEPECASH went {page.scoreboard.pepecash.change_pct > 0 ? "+" : ""}
                  {Math.round(page.scoreboard.pepecash.change_pct).toLocaleString("en-US")}% by monthly VWAP.
                </>
              )}
              {page.zaif && (
                <>
                  {" "}
                  Zaif&apos;s yen books turned over <b>{commas(Math.round(page.zaif.xcp_volume))} XCP</b> (
                  <span className="usd">{usdShort(page.zaif.usd)}</span>) across {page.zaif.days} trading days.
                </>
              )}
            </p>
            <div className="yr-panelbox">
              <div className="cap">
                <span>XCP · daily USD close</span>
                <span className="u">source: attributed market history · api.xcp.io</span>
              </div>
              <YearPriceChart daily={page.xcp_daily} />
            </div>
          </div>
        </section>
      )}

      {/* ---- the venues (only once the market has more than one) ---- */}
      {page.venues.length > 1 && (
        <section className="yr-band alt">
          <div className="yr-in">
            <div className="yr-kicker">
              <span>{kicker("the venues")}</span>
              <span className="rule" />
            </div>
            <h2 className="display">Where the money moved</h2>
            <p className="yr-lede">
              <span className="usd">{usdShort(page.stats.clean_usd)}</span> settled across{" "}
              <b>{page.venues.length} venues</b> in {page.year}.
            </p>
            <YearRows
              rows={page.venues.map((venue) => ({
                name: VENUE_LABELS[venue.venue]?.name ?? venue.venue,
                sub: VENUE_LABELS[venue.venue]?.sub,
                value: venue.usd,
                label: `${usdShort(venue.usd)} · ${commas(venue.fills)} fills`,
              }))}
            />
          </div>
        </section>
      )}

      {/* ---- the money (settlement currencies, when they tell a story) ---- */}
      {settlementInteresting && (
        <section className="yr-band">
          <div className="yr-in">
            <div className="yr-kicker">
              <span>{kicker("the money")}</span>
              <span className="rule" />
            </div>
            <h2 className="display">What trades settled in</h2>
            <p className="yr-lede">
              Nothing on the DEX was priced in dollars. In {page.year} the most-used settlement currency was{" "}
              <b className="grn">{page.settlement[0]!.currency}</b> with <b>{commas(page.settlement[0]!.fills)}</b>{" "}
              fills.
            </p>
            <YearRows
              chain
              rows={page.settlement.slice(0, 6).map((row) => ({
                name: row.currency,
                href: `/asset/${encodeURIComponent(row.currency)}`,
                value: row.fills,
                label: `${commas(row.fills)} fills${row.usd ? ` · ${usdShort(row.usd)}` : ""}`,
              }))}
            />
          </div>
        </section>
      )}

      {/* ---- the market ---- */}
      {page.stats.clean_fills > 0 && (
        <section className="yr-band alt">
          <div className="yr-in">
            <div className="yr-kicker">
              <span>{kicker("the market")}</span>
              <span className="rule" />
            </div>
            <h2 className="display">
              {commas(page.stats.clean_fills)} fills. {usdShort(page.stats.clean_usd)} real.
            </h2>
            <p className="yr-lede">
              Filtered to assets that pass today&apos;s quality signals, <b>{commas(page.stats.clean_fills)}</b> fills
              settled <span className="usd">{usdShort(page.stats.clean_usd)}</span> across all venues. The raw DEX tape
              alone printed <span className="usd">{usdShort(page.stats.dex_usd_raw)}</span> over{" "}
              {commas(page.stats.dex_fills_raw)} fills, wash included.
            </p>
            <div className="yr-panelbox">
              <div className="cap">
                <span>attributed USD by month · quality-filtered</span>
              </div>
              <YearMonthColumns values={monthlyUsd} usd labelMax={usdShort} />
            </div>
            {page.top_assets.length > 0 && (
              <YearRows
                rows={page.top_assets.slice(0, 8).map((asset) => ({
                  name: asset.asset_longname ?? asset.asset,
                  href: `/asset/${encodeURIComponent(asset.asset)}`,
                  value: asset.usd,
                  label: `${usdShort(asset.usd)} · ${commas(asset.fills)} fills`,
                }))}
              />
            )}
          </div>
        </section>
      )}

      {/* ---- the sales of the year: cards and coins ---- */}
      {((page.sale_of_year && page.sale_of_year.usd >= 100) ||
        (page.currency_sale_of_year && page.currency_sale_of_year.usd >= 100)) && (
        <section className="yr-band">
          <div className="yr-in">
            <div className="yr-kicker">
              <span>{kicker("the sales")}</span>
              <span className="rule" />
            </div>
            <h2 className="display">Sales of the year</h2>
            {page.sale_of_year && page.sale_of_year.usd >= 100 && (
              <div className="yr-sale">
                <img
                  src={artUrl(page.sale_of_year.asset, ART_WIDTH.card)}
                  alt={`${page.sale_of_year.asset} card art`}
                />
                <div>
                  <div className="yr-kicker !mb-1">
                    <span>cards</span>
                  </div>
                  <div className="display sp">${commas(page.sale_of_year.usd)}</div>
                  <div className="sn">
                    <Link href={`/asset/${encodeURIComponent(page.sale_of_year.asset)}` as Route}>
                      {page.sale_of_year.asset}
                    </Link>{" "}
                    · {page.sale_of_year.quantity <= 1 ? "1 of 1 sold" : `${commas(page.sale_of_year.quantity)} units`}
                  </div>
                  <div className="sd">
                    {page.sale_of_year.day} · settled in {page.sale_of_year.currency} · via {page.sale_of_year.venue}
                  </div>
                </div>
              </div>
            )}
            {page.currency_sale_of_year && page.currency_sale_of_year.usd >= 100 && (
              <div className="yr-sale">
                <img
                  src={artUrl(page.currency_sale_of_year.asset, ART_WIDTH.card, "icon")}
                  alt={`${page.currency_sale_of_year.asset} icon`}
                />
                <div>
                  <div className="yr-kicker !mb-1">
                    <span>coins &amp; currencies</span>
                  </div>
                  <div className="display sp">${commas(page.currency_sale_of_year.usd)}</div>
                  <div className="sn">
                    <Link href={`/asset/${encodeURIComponent(page.currency_sale_of_year.asset)}` as Route}>
                      {page.currency_sale_of_year.asset}
                    </Link>{" "}
                    ·{" "}
                    {page.currency_sale_of_year.asset === "BTC"
                      ? // BTC has no issuance row, so trade quantities stay in raw satoshis.
                        `${commas(page.currency_sale_of_year.quantity / 1e8)} BTC in one fill`
                      : `${commas(page.currency_sale_of_year.quantity)} units in one fill`}
                  </div>
                  <div className="sd">
                    {page.currency_sale_of_year.day} · settled in {page.currency_sale_of_year.currency} · via{" "}
                    {page.currency_sale_of_year.venue}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- the cards ---- */}
      {(page.cards.length >= 4 || page.collections.length > 0) && (
        <section className="yr-band alt">
          <div className="yr-in">
            <div className="yr-kicker">
              <span>{kicker("the cards")}</span>
              <span className="rule" />
            </div>
            <h2 className="display">The class of {page.year}</h2>
            {page.cards.length >= 4 && (
              <>
                <p className="yr-lede">The most-traded cards among those first issued in {page.year}.</p>
                <div className="yr-gallery">
                  {page.cards.slice(0, 10).map((card) => (
                    <Link
                      key={card.asset}
                      className="yr-card"
                      href={`/asset/${encodeURIComponent(card.asset)}` as Route}
                    >
                      <img
                        src={artUrl(card.asset, ART_WIDTH.thumbnail)}
                        alt={`${card.asset} card art`}
                        loading="lazy"
                      />
                      <div className="cn">{card.asset}</div>
                      <div className="cv">
                        <b>{usdShort(card.usd)}</b> traded · {collectionLabel(card.tag)}
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
            {page.collections.length > 0 && (
              <YearRows
                chain
                rows={page.collections.map((collection) => ({
                  name: collection.name === collection.tag ? collectionLabel(collection.tag) : collection.name,
                  href: `/tag/${encodeURIComponent(collection.tag)}`,
                  value: collection.cards,
                  label: `${commas(collection.cards)} cards`,
                }))}
              />
            )}
            <p className="yr-foot">
              Cards counted by first issuance inside {page.year}, via collection membership evidence — collections can
              adopt assets issued before they existed.
            </p>
          </div>
        </section>
      )}

      {/* ---- moments ---- */}
      <section className="yr-band">
        <div className="yr-in">
          <div className="yr-kicker">
            <span>{kicker("moments")}</span>
            <span className="rule" />
          </div>
          <h2 className="display">The year, dated</h2>
          <ul className="yr-moments">
            {page.editorial.moments.map((moment) => (
              <li key={moment.label + moment.text.slice(0, 16)}>
                <span className="d">{moment.label}</span>
                <span className="m">{editorialText(moment.text)}</span>
              </li>
            ))}
            {page.protocol.map((event) => (
              <li key={event.date}>
                <span className="d">{event.date.slice(5).replace("-", " ").toUpperCase()}</span>
                <span className="m">
                  <b>{event.name}.</b> {event.note}
                </span>
              </li>
            ))}
          </ul>
          {page.editorial.meanwhile.length > 0 && (
            <p className="yr-foot" style={{ marginTop: 26 }}>
              <b style={{ color: "var(--t2)" }}>Meanwhile, outside:</b>{" "}
              {page.editorial.meanwhile.map((line, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  {line}
                </span>
              ))}
            </p>
          )}
          {page.editorial.graffiti && (
            <div className="yr-graffiti">
              <div className="q">&ldquo;{page.editorial.graffiti.text}&rdquo;</div>
              <div className="a">broadcast on-chain · {page.editorial.graffiti.day}</div>
            </div>
          )}
          {page.editorial.lexicon.length > 0 && (
            <div className="yr-lex" aria-label="Words of the year">
              {page.editorial.lexicon.map((word) => (
                <span key={word}>{word}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- colophon ---- */}
      <footer className="yr-band alt pb-20">
        <div className="yr-in">
          <div className="yr-kicker">
            <span>colophon</span>
            <span className="rule" />
          </div>
          <p className="yr-foot" style={{ fontSize: 14 }}>
            Every number on this page is served by <span className="font-mono">GET /v2/years/{page.year}</span> from the
            Counterparty mirror behind xcp.io — trades and issuances from the raw 1:1 capture, dollars from the{" "}
            <Link href={"/usd-methodology" as Route}>attributed USD price history</Link>. Quality filtering excludes
            wash-flagged assets; raw and filtered figures are always labeled.
          </p>
          <div className="yr-jump">
            {previous ? (
              <Link className="display" href={`/year/${previous.year}` as Route}>
                ← {previous.year}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link className="display" href={`/year/${next.year}` as Route}>
                {next.year} →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
