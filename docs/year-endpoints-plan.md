# Year pages — API design & implementation plan

Data layer for `xcp.io/year/[year]` ("Counterparty Unwrapped", 2014–2026). Companion to
`docs/year-unwrapped.md` (the content research). Owner does visual design; this specifies
endpoints, payload shapes, query sources, and caching.

## Principles

- **Computed vs curated, explicitly separated.** Numbers come from SQL over the mirror; editorial
  content (titles, moments, graffiti quotes, "meanwhile outside", lexicon) comes from a curated
  catalog in the repo. The payload carries both, but every computed field is reproducible from a
  query and every curated field is authored. No number is hand-typed into the catalog.
- **Frozen facts, firsts-style caching.** Completed years never change (chain finality + our
  pricing calendars). Follow the `/v2/firsts` precedent: compute live behind `cached()` with a
  ~1-year TTL and a **versioned cache key**; bump the version when the catalog or a query changes.
  The current year uses a short TTL instead. No new tables, no migration, no cron — Phase 2 only
  if cold-compute latency proves annoying (then: a `year_snapshots` generation table à la
  `exchange_top_assets`, numbered migration, admin-triggered build).
- **Wire ≠ storage.** All response shapes in `packages/shared/src/years.ts`. SQL lives in
  `apps/api/src/queries/years.ts` (catalog co-located there, like `FIRSTS_CATALOG`). The route
  module `apps/api/src/read/years.ts` stays thin: parse → query → envelope.

## Endpoints

### `GET /v2/years` — the index (nav + cross-year strips)

One row per year, 2014→current. Powers: the year-nav sparkline, the scoreboard strip, the records
ledger, and prev/next headers. Payload `Envelope<YearIndex>`:

```ts
// packages/shared/src/years.ts
export interface YearSummary {
  year: number;
  partial: boolean;              // true only for the current year
  transactions: number;
  actors: number;                // distinct tx sources
  newcomers: number;             // first-ever tx this year
  new_assets: number;
  issuers: number;
  dex_fills_raw: number;         // venue='dex', unfiltered
  clean_usd: number;             // all venues, low_quality=0
  xcp: YearOhlc;                 // open/close/high/low USD
  btc: YearOhlc;
  records: string[];             // keys this year holds, e.g. ["dex_fills_raw","clean_usd"]
}
export interface YearOhlc { open: number; close: number; high: number; low: number; change_pct: number; }
export interface YearIndex { as_of: number; years: YearSummary[]; }
```

`records` is computed in the handler from the assembled index (max per metric) — never hardcoded,
so a record migrating to a new year (e.g. 2026 completing) corrects itself.

### `GET /v2/years/:year` — the page

Validation: integer, `2014 <= year <= currentYear`, else 404. Payload `Envelope<YearPage>`:

```ts
export interface YearPage {
  year: number;
  partial: boolean;
  as_of: number;                       // unix; matters for partial years
  editorial: YearEditorial;            // curated (see catalog)
  stats: YearStats;                    // computed
  scoreboard: {                        // computed
    xcp: YearOhlc; btc: YearOhlc;
    pepecash: { first_vwap: number; last_vwap: number; change_pct: number } | null; // null pre-2016 / illiquid years
  };
  xcp_daily: [string, number][];       // ["2017-01-01", 1.92] × ~365 — the hero chart
  monthly: YearMonth[];                // per-month: clean dex usd+fills, new assets
  venues: { venue: string; fills: number; usd: number }[];        // clean, desc by usd
  settlement: { currency: string; fills: number; usd: number | null }[]; // dex venue, top 8 by fills
  top_assets: { asset: string; asset_longname: string | null; fills: number; usd: number }[]; // clean, top 10
  sale_of_year: YearSale | null;       // biggest single clean fill, qty<=10, collection member
  collections: { tag: string; name: string; cards: number }[];    // top 8 born-in-year (evidence caveat applies)
  cards: { asset: string; usd: number; fills: number; tag: string }[]; // class-of-year: born AND traded in-year, top 10
  zaif: { days: number; xcp_volume: number; usd: number } | null; // attributable CEX lane
  protocol: { date: string; name: string; note: string }[];       // curated list, dates verified against blocks
}
export interface YearStats {
  transactions: number; actors: number; newcomers: number; newcomer_pct: number;
  new_assets: number; issuers: number; subassets: number;
  sends: number; supply_locks: number; ownership_transfers: number;
  dex_fills_raw: number; dex_usd_raw: number; clean_fills: number; clean_usd: number;
}
export interface YearMonth { month: number; clean_usd: number; clean_fills: number; new_assets: number; }
export interface YearSale { asset: string; usd: number; day: string; currency: string; venue: string; quantity: number; }
export interface YearEditorial {
  title: string;                       // "The Mania Year"
  angle: string;                       // one-sentence thesis
  moments: { label: string; text: string }[];   // "DEC 19" / markdown-lite text
  graffiti: { day: string; text: string } | null;
  meanwhile: string[];                 // outside-world context lines (verified only)
  lexicon: string[];                   // words of the year
}
```

Card art is NOT in the payload — the web layer builds CDN URLs from `cards[].asset` via
`lib/art.ts` (same as everywhere else).

## The curated catalog

`YEARS_CATALOG: Record<number, YearEditorial>` in `apps/api/src/queries/years.ts`, transcribed
from `docs/year-unwrapped.md` **after** its per-year curation pass (hero fact, ≤6 moments, one
graffiti quote, ≤3 meanwhile lines — only `(data)` / `(chat-grounded)` / `(primary source)` items;
every `(context — verify)` item stays out until verified). Protocol entries come from
`protocol_changes.json` block heights, with dates resolved once against our `blocks` table and
written into the catalog as literals (they're immutable).

## Query sources (all proven in the research session, 2026-07-19/20)

| Payload field | Source query (one line each) | Cost note |
|---|---|---|
| stats.transactions/actors | `transactions` GROUP BY year window | ~7s full scan — the expensive one |
| stats.newcomers | MIN(block_time) per source_id, year bucket | ~10s full scan |
| stats.new_assets/issuers/subassets | `assets` by first_issuance year | fast |
| stats.sends | `sends` count in range | ~2s |
| stats.supply_locks / ownership_transfers | `issuances` locked=1 / transfer=1 in range | ~1.5s |
| dex raw fills/usd | `trades` venue='dex' in range | fast |
| clean fills/usd, venues, monthly | `trades` LEFT JOIN `asset_signals` low_quality=0 | fast |
| settlement | `trades` venue='dex' GROUP BY currency | fast |
| top_assets | clean trades GROUP BY asset_id, join dictionary | fast |
| sale_of_year | clean trades qty<=10, collection-member join, MAX usd | ~8s (window) |
| collections | `collection_membership_evidence` join assets by birth year | fast |
| cards | same + born-in-year + traded-in-year | fast |
| xcp_daily / OHLC | `prices` currency='XCP' | trivial |
| btc OHLC | `prices` currency='BTC' | trivial |
| pepecash vwap | trades VWAP first/last month; null if < N fills either month | fast |
| zaif | `market_price_observations` venue='cex' base='XCP' + CEX_USD formula | fast |

Handler runs them with `Promise.all` batches; total cold compute ≈ 20–30s for one year — fine
under the worker's 300s CPU limit and only paid on cache miss. `/v2/years` (index) reuses the
same by-year GROUP BY queries once for **all** years (single scans, not per-year), so its cold
cost ≈ one year's.

**Consistency rule**: the two big scans (`transactions`, newcomers) are shared between index and
year pages via identical SQL in `queries/years.ts` — one definition, imported by both handlers,
so a year page can never disagree with the index.

## Caching

- `/v2/years` → `cached(c, "years:index:v1", { ttl: 86400, edge: 3600, swr: 604800 })` — daily,
  because the current year moves.
- `/v2/years/:year` completed years → `cached(c, `years:${year}:v1`, { ttl: 31_536_000, edge: 86_400, swr: 31_536_000 })`.
- `/v2/years/:year` current year → ttl 3600.
- Bump `v1` in the key whenever the catalog or any query changes (firsts precedent).

## Web layer (for when design lands)

- `apps/web/src/app/year/[year]/page.tsx` — server component, fetches `/v2/years/:year` (+ index
  for the nav strip), `revalidate` mirroring the API TTLs. `generateMetadata` per year.
- The asset page's year chip gets `href={`/year/${issuedYear}`}` (SectionChip already takes href).
- Card art: `artUrl(asset, ART_WIDTH.thumbnail)` from `cards[]`.
- The 2017 artifact's two known overclaims ("all-time record", "never this loud again") are
  corrected for free once the page reads `records` from the index.

## Build order

1. `packages/shared/src/years.ts` (wire shapes above) + subpath export.
2. `apps/api/src/queries/years.ts` — SQL functions + `YEARS_CATALOG` (start with 2017, 2014, 2021,
   2020 to prove the format flexes; fill the other nine after).
3. `apps/api/src/read/years.ts` — two routes, mounted in `src/index.ts`.
4. Tests (`apps/api/tests/years.test.ts`): shape assertions, records self-consistency (each record
   key appears exactly once across the index), 404s, partial-year flag, catalog/computed-year
   parity (every catalogued year within range).
5. Verify against the research numbers: the doc's master table is the expected-output fixture —
   assert 2017 returns 401,390 txs / 49,811 raw fills / $16.2M etc.
6. Web route (after design).

Definition of done per repo rules: `npm run check`, `npm test -w xcp-api`, hit
`/v2/years/2017` on prod and eyeball against `docs/year-unwrapped.md`.
