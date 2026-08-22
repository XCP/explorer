/**
 * /v2/years + /v2/years/:year — the year-in-review pages ("Counterparty Unwrapped").
 * Completed years are frozen facts (chain finality + reviewed price calendars), so they follow the
 * /v2/firsts precedent: computed live behind the D1 cache with a long TTL and a VERSIONED key —
 * bump YEARS_CACHE_VERSION when the catalog or any query changes (that is also the operator lever
 * for propagating curation fixes like a new lowq flag into past years). The current year moves,
 * so it caches for an hour. Records are derived from the assembled index, never claimed by hand.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { YearIndex, YearPage, YearSummary } from "@xcp/shared/years";
import { router, cached } from "#api/read/respond";
import {
  FIRST_YEAR,
  YEARS_CATALOG,
  toOhlc,
  yearActivityLedger,
  yearAssetLedger,
  yearBurn,
  yearCards,
  yearCurrencySale,
  yearCleanLedger,
  yearCollections,
  yearEnd,
  yearMonthly,
  yearNewcomerLedger,
  yearOhlcLedger,
  yearPepecashVwap,
  yearProtocol,
  yearRawDexLedger,
  yearSaleOfYear,
  yearSettlement,
  yearStart,
  yearStatsDetail,
  yearTopAssets,
  yearVenues,
  yearXcpDaily,
  yearZaif,
} from "#api/queries/years";

const YEARS_CACHE_VERSION = "v11"; // v11: DOLLARCASH lowq flag
// The prior version's rows serve during recompute so a bump never cold-starts readers. Move BOTH
// constants forward together on the next bump (v12/v11, then v13/v12, …).
const YEARS_CACHE_STALE_VERSION = "v10";
export const YEARS_INDEX_CACHE_KEY = `years:index:${YEARS_CACHE_VERSION}`;
export const YEARS_INDEX_STALE_CACHE_KEY = `years:index:${YEARS_CACHE_STALE_VERSION}`;

/** Metrics eligible for the records ledger; partial years cannot hold records. */
const RECORD_KEYS = ["transactions", "actors", "newcomers", "new_assets", "dex_fills_raw", "clean_usd"] as const;

const currentYear = (): number => new Date().getUTCFullYear();

async function buildIndex(db: D1Database): Promise<YearIndex> {
  const [activity, newcomer, asset, rawDex, clean, xcp, btc] = await Promise.all([
    yearActivityLedger(db),
    yearNewcomerLedger(db),
    yearAssetLedger(db),
    yearRawDexLedger(db),
    yearCleanLedger(db),
    yearOhlcLedger(db, "XCP"),
    yearOhlcLedger(db, "BTC"),
  ]);
  const by = <T extends { y: string }>(rows: T[]) => new Map(rows.map((row) => [Number(row.y), row]));
  const activityBy = by(activity);
  const newcomerBy = by(newcomer);
  const assetBy = by(asset);
  const rawBy = by(rawDex);
  const cleanBy = by(clean);
  const xcpBy = by(xcp);
  const btcBy = by(btc);

  const now = currentYear();
  const years: YearSummary[] = [];
  for (let year = FIRST_YEAR; year <= now; year++) {
    years.push({
      year,
      title: YEARS_CATALOG[year]?.title ?? String(year),
      partial: year === now,
      transactions: activityBy.get(year)?.transactions ?? 0,
      actors: activityBy.get(year)?.actors ?? 0,
      newcomers: newcomerBy.get(year)?.newcomers ?? 0,
      new_assets: assetBy.get(year)?.new_assets ?? 0,
      issuers: assetBy.get(year)?.issuers ?? 0,
      dex_fills_raw: rawBy.get(year)?.fills ?? 0,
      dex_usd_raw: rawBy.get(year)?.usd ?? 0,
      clean_fills: cleanBy.get(year)?.fills ?? 0,
      clean_usd: cleanBy.get(year)?.usd ?? 0,
      xcp: toOhlc(xcpBy.get(year)),
      btc: toOhlc(btcBy.get(year)),
      records: [],
    });
  }
  for (const key of RECORD_KEYS) {
    let best: YearSummary | null = null;
    for (const summary of years) {
      if (summary.partial) continue;
      if (!best || summary[key] > best[key]) best = summary;
    }
    if (best && best[key] > 0) best.records.push(key);
  }
  return { as_of: Math.floor(Date.now() / 1000), years };
}

/** Reuse the globally materialized index instead of repeating its seven full-ledger scans per year page. */
export async function readCachedYearIndex(db: D1Database): Promise<YearIndex | null> {
  for (const key of [YEARS_INDEX_CACHE_KEY, YEARS_INDEX_STALE_CACHE_KEY]) {
    const row = await db.prepare(`SELECT body FROM cache WHERE key=?`).bind(key).first<{ body: string }>();
    if (!row?.body) continue;
    try {
      const parsed = JSON.parse(row.body) as { result?: YearIndex };
      if (parsed.result && Number.isFinite(parsed.result.as_of) && Array.isArray(parsed.result.years)) {
        return parsed.result;
      }
    } catch {
      // A malformed cache row is not authoritative. Fall through to the next version or rebuild.
    }
  }
  return null;
}

export const years = router();

years.get("/v2/years", (c) =>
  cached(
    c,
    YEARS_INDEX_CACHE_KEY,
    { ttl: 86_400, edge: 3_600, swr: 604_800, staleKey: YEARS_INDEX_STALE_CACHE_KEY },
    async (): Promise<Envelope<YearIndex>> => ({ result: await buildIndex(c.env.CORE_DB) }),
  ),
);

years.get("/v2/years/:year", (c) => {
  const year = Number(c.req.param("year"));
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear()) {
    return c.json({ error: "unknown year" }, 404);
  }
  const partial = year === currentYear();
  return cached(
    c,
    `years:${year}:${YEARS_CACHE_VERSION}`,
    {
      ...(partial ? { ttl: 3_600, edge: 300, swr: 86_400 } : { ttl: 31_536_000, edge: 86_400, swr: 31_536_000 }),
      staleKey: `years:${year}:${YEARS_CACHE_STALE_VERSION}`,
    },
    async (): Promise<Envelope<YearPage>> => {
      const db = c.env.CORE_DB;
      const start = yearStart(year);
      const end = yearEnd(year);
      // The all-year ledgers are shared with the index (one SQL definition), so a year page can
      // never disagree with the nav strip built from /v2/years.
      const [
        index,
        assetLedger,
        detail,
        monthly,
        venues,
        settlement,
        topAssets,
        sale,
        currencySale,
        burn,
        collections,
        cards,
        daily,
        pepecash,
        zaif,
      ] = await Promise.all([
        readCachedYearIndex(db).then((index) => index ?? buildIndex(db)),
        yearAssetLedger(db),
        yearStatsDetail(db, start, end),
        yearMonthly(db, start, end),
        yearVenues(db, start, end),
        yearSettlement(db, start, end),
        yearTopAssets(db, start, end),
        yearSaleOfYear(db, start, end),
        yearCurrencySale(db, start, end),
        yearBurn(db, start, end),
        yearCollections(db, start, end),
        yearCards(db, start, end),
        yearXcpDaily(db, year),
        yearPepecashVwap(db, start, end),
        yearZaif(db, year),
      ]);
      const summary = index.years.find((row) => row.year === year);
      if (!summary) throw new Error(`year ${year} missing from index`);
      const editorial = YEARS_CATALOG[year] ?? {
        title: String(year),
        angle: "",
        moments: [],
        graffiti: null,
        meanwhile: [],
        lexicon: [],
      };
      return {
        result: {
          year,
          partial,
          as_of: index.as_of,
          editorial,
          stats: {
            transactions: summary.transactions,
            actors: summary.actors,
            newcomers: summary.newcomers,
            newcomer_pct: summary.actors ? Math.round((summary.newcomers / summary.actors) * 1000) / 10 : 0,
            new_assets: summary.new_assets,
            issuers: summary.issuers,
            subassets: assetLedger.find((row) => Number(row.y) === year)?.subassets ?? 0,
            sends: detail?.sends ?? 0,
            supply_locks: detail?.supply_locks ?? 0,
            ownership_transfers: detail?.ownership_transfers ?? 0,
            dex_fills_raw: summary.dex_fills_raw,
            dex_usd_raw: summary.dex_usd_raw,
            clean_fills: summary.clean_fills,
            clean_usd: summary.clean_usd,
          },
          scoreboard: { xcp: summary.xcp, btc: summary.btc, pepecash: pepecash },
          xcp_daily: daily.map((row) => [row.day, row.usd] as [string, number]),
          monthly,
          venues,
          settlement,
          top_assets: topAssets,
          sale_of_year: sale,
          currency_sale_of_year: currencySale,
          burn,
          collections,
          cards,
          zaif,
          protocol: yearProtocol(year),
        },
      };
    },
  );
});
