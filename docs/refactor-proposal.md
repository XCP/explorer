# xcp-explorer — Architecture Review & Refactoring Proposal

*2026-07-06. Based on a full review of both apps (~5.8k LOC), all 20 migrations, and the docs.*

## Verdict up front

There are two different codebases here wearing one repo, and they deserve different verdicts.

**The data architecture (the indexer) is genuinely designed.** It has nameable patterns applied on
purpose: an event-sourced mirror with idempotent replay, derived read models maintained by a
dirty-set cascade with a self-healing full rebuild (recompute-over-delta), read-time scoring over a
config surface. You could hand `apps/api/docs/architecture.md` to a new engineer and they'd know
where everything goes. Preserve it.

**The application architecture — the API read layer and the entire web app — is not designed; it's
conventions that accreted.** Named honestly:

- Every read handler is a **transaction script** (Fowler's term): parse params → inline 20–60 lines
  of SQL → shape JSON, all in one function. There is no data-access layer. SQL lives wherever it's
  consumed, and the "sharing" mechanism is exported string fragments (`ORDER_SELECT`,
  `activeBalance("b.")`, `xcpDestroyed(extra)`) — string-composition SQL without a builder, plus
  files like `curated.ts` that are literally grab bags of SQL constants passed around by import.
  That's not a pattern; it's the absence of one, papered over with `import`.
- The web app is **three god modules plus pages**: `columns.tsx` (display config + cell renderers +
  slug routing), `hooks.ts` (all data fetching + the type that names every index), `ui.tsx`
  (15 unrelated components). The column-registry idea is *close* to a real pattern (TanStack Table's
  column defs) but home-grown, untyped (`cell: (r: any)`), and split across three files — so it has
  the shape of config-driven rendering without the benefit (type safety) that justifies it.
- Types and constants have no organization: no shared API contract (each side re-invents or `any`s
  the wire shapes), page sizes and refresh intervals hardcoded inline where used.

So "lack of architecture" is the right diagnosis for the application layer — transaction scripts are
fine at 10 endpoints and become a liability at 30+, which is where this is heading. The refactor
below is therefore not just cleanup: Phases 1–3 introduce the two missing layers (a **contract
layer** and a **query layer**) that turn the conventions into an architecture you can name.
**This is still not a rewrite proposal** — the indexer keeps its design, and the seams proposed are
extractions, not reinventions.

The problems cluster in five areas, in priority order:

1. **No shared type contract between API and web** — both sides are drowning in `any` at the boundary.
2. **The web app uses none of Next.js** — every page is `"use client"` + browser-side SWR; no SSR, no
   per-page metadata, no streaming. For an *explorer* (a fundamentally SEO/crawler/link-preview-driven
   product) this is the biggest missed win.
3. **God files and copy-paste** — `ui.tsx`, `shared.ts`, duplicated `Board`/`Feed` components, the
   index registry split across three files.
4. **Operational logic baked into code** — curated lists require deploys; admin auth via query string;
   no tests despite an excellent verification harness to build on.
5. **Repo hygiene** — stray operational files committed (`tailout.txt`, `.salestok`, `drive_*.sh`,
   progress logs).

---

## What's good — do not touch

- **Layer architecture** (`apps/api/docs/architecture.md`): ingest is deterministic and derived data
  never contaminates mirror tables. The dirty-set cascade + full-rebuild backstop gives freshness
  without incremental drift. Keep it.
- **Idempotent replay** (`sync.ts` high-water marks, reorg snapshots) — bulletproof; don't refactor.
- **Feature units** declaring `full` + `scoped` SQL in `signals.ts` — the two-driver design
  (cascade + self-healing rebuild) is the single best idea in the codebase.
- **Config-driven reputation** (`reputation/config.ts` as the whole tuning surface).
- **Layered caching**: edge cache + D1 `cache` table with SWR + block-delta gates (`maybeAnalyze`).
- **Web: `INDEXES` config + `IndexPage` + `RecordTable`** — 15 index pages as one-liners, responsive
  `hideBelow` column dropping. Keep the pattern; type it (below).
- **SWR global config** (`swr-provider.tsx`) — sensible; keep for the parts that stay client-side.

---

## Phase 0 — Hygiene (30 min, do immediately)

- Delete / gitignore: `apps/api/tailout.txt` (4 MB), `apps/api/.salestok`, `*_progress.log`.
- Move `drive_emblem.sh`, `drive_reindex.sh`, `SESSION-HANDOFF.md` → `apps/api/ops/` (or delete the
  handoff once the reindex saga is resolved — it's a point-in-time runbook, not architecture doc).
- Add root `.gitignore` entries for `*.log`, `tailout*`, token files.
- Root `package.json`: add workspace-level scripts (`dev:api`, `dev:web`, `typecheck`, `test`) so the
  monorepo is drivable from the root.

## Phase 1 — Shared API contract (`packages/shared`) — the highest-leverage change

Create a third workspace, `packages/shared`, exporting the wire types once:

```
packages/shared/src/
  envelope.ts     // Envelope<T> = { result: T; result_count?: number; next_offset?: number | null }
  models.ts       // AssetDetail, AssetRow, BalanceRow, OrderRow, SendRow, BlockRow, TxRow,
                  // AddressSummary, Reputation, HolderMakeup, ... one interface per endpoint payload
  index-names.ts  // the IndexName union — single source of truth
```

- **API side**: each read handler's final `J(c, {...})` return is annotated
  `Envelope<AssetDetail>` etc. Add a `j<T>(c, body: Envelope<T>, ttl?)` typed wrapper around `J` so
  forgetting `next_offset` on a list endpoint is a compile error (fixes reviewer finding #10).
- **Web side**: `useList<SendRow>("/v2/sends")`, `Col<SendRow>` in `columns.tsx` — kills the ~35
  `any`s on each side *with one set of types*, and makes an API field rename a compile error in
  both apps instead of a silent runtime break.
- Don't reach for OpenAPI/codegen yet — at ~30 endpoints, hand-written interfaces in one package are
  cheaper and more readable. Revisit codegen if the surface doubles.

**Typed D1 helper** (in `apps/api/src/db.ts`):

```ts
export const q = <T>(db: D1Database, sql: string, ...binds: unknown[]) =>
  db.prepare(sql).bind(...binds).all<T>().then(r => r.results);
export const one = <T>(db: D1Database, sql: string, ...binds: unknown[]) =>
  db.prepare(sql).bind(...binds).first<T>();
```

Every `const sig: any = await ...` becomes `await one<AssetSignalsRow>(...)`. Define
`AssetSignalsRow` / `AddressSignalsRow` once (they're the schema-duplication hotspot the API review
flagged — three hand-maintained column lists today collapse to one interface + the migration).

## Phase 2 — Web: adopt the server/client hybrid Next.js is built for

Today all 27 pages are client components fetching from the browser. Proposal — **hybrid, not
wholesale RSC conversion**:

- **Detail pages (asset / address / block / tx) become server components.** These are the SEO- and
  link-preview-critical pages. The page fetches the primary object server-side (plain `fetch` to the
  API with `next: { revalidate: 30 }`), renders the header/KV card as HTML, and implements
  `generateMetadata` (title = asset name, description, OG image from asset art). The live bits
  (MarketChip, DetailTabs pagination, holder-makeup) stay client components receiving the initial
  object as props — SWR keeps powering interaction.
- **Index pages stay client** (`IndexPage` is already ideal for paginated live lists), but add
  `generateMetadata`-equivalent static `metadata` per route and a shared `loading.tsx`.
- **Add `app/error.tsx` and `app/not-found.tsx`** — today a failed fetch renders a bare error string
  with no recovery; an API 404 on `/asset/NOPE` should be a real 404 (`notFound()`), which also fixes
  crawler soft-404s.
- **Home page**: fetch the stats/feeds server-side (it's fully cacheable — the API already has the D1
  cache for exactly these aggregations), stream with Suspense; keep the mempool ticker client-side.
- API base for server-side fetches: same `NEXT_PUBLIC_API_BASE` (it's public anyway); OpenNext on
  Cloudflare makes these worker-to-worker calls — cheap.

**Component reorganization:**

```
components/
  ui/            // split ui.tsx by concern — NO index.ts barrel; import ui/card etc. directly:
    card.tsx  table.tsx  feedback.tsx (Loading/ErrorBox/Empty/Skeleton)  buttons.tsx  charts.tsx
    async-content.tsx    // NEW: <AsyncContent loading error empty>{...}</AsyncContent> —
                         // the one place the loading/error/empty ternary chain lives
  board.tsx      // extracted from vaults/exchanges pages (currently copy-pasted)
  feed.tsx       // extracted from home page
  ...page-specific components stay flat
```

**Single index registry — make the implicit pattern real.** What `columns.tsx` + `hooks.ts` +
`SLUG_TO_INDEX` are reaching for is a **column-definition registry** (the TanStack Table idea).
Either adopt TanStack Table outright, or — lighter and probably right here — merge the three into
one `lib/registry.ts` object where each entry is `{ slug, endpoint, title, cols: Col<Row>[] }` and
the union type is derived from its keys (`export type IndexName = keyof typeof REGISTRY`). Adding an
index becomes a one-place change, and the five phantom IndexName members with no route/columns
(bet_matches, rps, rps_matches, pools, pool_matches) either get pages or disappear from the type.
Constants get the same treatment: one `lib/config.ts` for page sizes and refresh intervals instead
of magic numbers at each use site.

**Typing the column system.** `Col<T>` with `cell: (r: T) => ReactNode`, rows typed per registry
entry from `packages/shared`. This is where the shared types pay off most — the cell renderers are
currently the largest `any` surface in the web app.

Small fixes bundled in: `aria-label` on the search button, text label alongside buy/sell colors,
ESC-dismiss for the mobile menu, `DetailTabs` gets `pageSize` + Prev/Next parity with `IndexPage`.

## Phase 3 — API: introduce the query layer, then safety and operability

1. **Extract a query layer** — the structural fix for the transaction-script problem. Per domain,
   a module of named, typed query functions:

   ```
   src/queries/
     assets.ts      // getAsset(db, name): Promise<AssetDetailRow | null>
                    // listAssets(db, {query, limit, offset}): Promise<AssetRow[]>
     addresses.ts   // getAddressSummary, listBalances, ...
     orders.ts      // the ORDER_SELECT normalization lives HERE, unexported as SQL
     ...
   ```

   Route handlers shrink to: parse params → call query fn → wrap in envelope. The exported SQL
   string fragments (`ORDER_SELECT`, `activeBalance`, `xcpDestroyed`) and the `curated.ts` SQL
   grab bag disappear as a *sharing mechanism* — fragments become private helpers inside the query
   module that owns them, and curated data moves to tables (item 5). This is deliberately
   repository-*lite*: plain functions over the typed `q<T>()` helper, no ORM, no interfaces-for-
   interfaces'-sake. The win is that SQL becomes findable (one directory), testable (call the
   function against local D1), and typed at the edge.
   What stays in `read/`: routing + envelope only (`respond.ts` with J/cached/lim/off).
2. **Error handling middleware**: one `app.onError` per Hono app producing a consistent
   `{ error, status }` envelope; stop ad-hoc `c.json({error}, 4xx)` shapes across verify/admin/read.
3. **Admin auth**: accept `Authorization: Bearer` (keep query-string as deprecated fallback for the
   drive scripts, then remove). Query-string tokens leak into logs and cache keys.
4. **Validate the signal-unit dependency graph at module load**: a ~15-line topological check that
   every `dependsOn` names a real unit and that ordering is consistent; throw on deploy, not at 3am.
   Same place: assert that `periodic` units are never invoked by the scoped cascade driver (today
   it's convention documented in architecture.md, not enforced).
5. **Curated data → tables.** `curated.ts` SQL blobs, `LEGACY_CONTRACTS` (emblem.ts), the exchange
   `NAMES` map (exchanges.ts) become rows in a `curated` table (`kind, key, value, note`), editable
   via an admin endpoint. Deploys stop being the edit mechanism for data. Seed migration carries the
   current lists so history is preserved.
6. **Supply-queue atomicity**: enqueue the supply-dirty marker inside the same `batch()` as the
   event writes in `sync.ts` so an event can't land without its supply refetch being queued.
7. **Tests — start from what exists.** The `verify.ts` harness and `/admin/verify-signals` diff are
   already the hard part. Add: (a) unit tests for `reputation/score.ts` (pure functions — trivial to
   test: zero-holder assets, decay boundaries, penalty application); (b) a cascade-equivalence test
   that seeds a small D1 (wrangler local), runs one unit's `scoped` vs `full` SQL and asserts equal
   rows — that's the invariant the whole Layer-2 design rests on; (c) codec tests
   (`codec.ts` base64/stamp classification). The `npm test` scaffold already exists in package.json.
8. **Perf guardrails**: commit `docs/query-perf.md` discipline as a rule — any new read endpoint gets
   an `EXPLAIN QUERY PLAN` check against local D1 before merge (a small `ops/explain.sh` that runs
   the query file through wrangler d1). The 18s→0.5s ANALYZE story shows how easy it is to ship an
   accidental scan.
9. **Address summary query** (`addresses.ts:147-157`): collapse the 11 scalar subqueries into one
   pass where possible (single round trip already, but each subquery scans independently; a UNION ALL
   aggregation or session batch keeps it index-only).

## Phase 4 — Monorepo shape (end state)

```
xcp-explorer/
  package.json            // workspaces + root scripts (dev, typecheck, test, deploy)
  docs/                   // cross-cutting docs (this file; move architecture.md here or link it)
  packages/
    shared/               // wire types: envelope, models, index names
  apps/
    api/
      src/
        index.ts          // composition root (unchanged shape)
        db.ts             // typed D1 helpers
        read/             // thin routers + respond.ts + sql.ts
        indexer/          // sync + events/ + signals + crawlers (unchanged shape)
        reputation/
      ops/                // drive scripts, runbooks
      migrations/
      test/
    web/
      src/
        app/              // server pages for details, client index pages, error/loading/not-found
        components/ui/    // split primitives
        lib/registry.ts   // single index registry
        lib/…             // api.ts, hooks.ts, format.ts (typed via packages/shared)
```

## Sequencing & effort

| Phase | Effort | Risk | Why this order |
|---|---|---|---|
| 0 Hygiene | ~30 min | none | Free wins; unblocks clean diffs |
| 1 Shared types + db helper | ~1 day | low | Everything else compiles against it |
| 2 Web hybrid RSC + reorg | ~2–3 days | medium | Biggest user-facing win (paint, SEO); shared types make it safe |
| 3 API cleanups + tests | ~2–3 days | low–medium | Independent items, land piecemeal |
| 4 Monorepo polish | continuous | none | Falls out of 0–3 |

Each phase ships independently; nothing requires a big-bang migration. Phase 2's page-by-page
conversion order: asset → address → tx/block → home (SEO value order).

## Roadmap — the agreed system picture and prioritized next steps

The system in one paragraph (owner's framing, confirmed by review): **three indexers** — the
Counterparty event replayer (kept pure, 1:1 mirror), the Emblem Vault crawler, and the Emblem
sales crawler — stand side by side. **Derived layers** (signals, reputation, tags, and the
planned unified **trades** table) build on top of them and never contaminate the mirrors. The
**front end** consumes it all through efficient queries, layered caching, and best-in-class
Next.js/React componentry.

Prioritized steps (each independently shippable, in order):

0. **Production health check** — SESSION-HANDOFF (2026-06-28) recorded a stuck reindex / paused
   cron / degraded site. Verify tip freshness, cron state, and signal completeness before landing
   refactors on the write path.
1. **Hygiene + write the target architecture down** (Phase 0, plus: update architecture.md with
   the pattern names, the three-indexer picture, and the trades-table plan). Docs first because
   future sessions build from them.
2. **Contract layer** (Phase 1) — packages/shared DTOs + typed row interfaces + `q<T>()` helper.
   Hand-written row types now; revisit Drizzle once schema churn slows and the reindex era is over.
3. **API query layer + safety items** (Phase 3), extracted domain-by-domain — assets first
   (biggest file), then addresses, then the rest. Curated lists → tables; Bearer admin auth;
   error middleware; signal-unit dependency validation; scorer + cascade-equivalence tests.
4. **Trades table as the pilot of the new architecture.** A derived projection unifying
   order_matches + dispenses + emblem sales into one queryable trades surface — built the new way
   from day one: schema in a migration, row type in shared, a feature-unit-style builder
   (full + scoped) in the indexer, a query module, typed DTO, registry entry on the web.
5. **Web overhaul** (Phase 2) — registry + ui/ split + typed SDK/hooks first, then RSC hybrid
   conversion page-by-page in SEO-value order: asset → address → tx/block → home.
6. **Polish** — EXPLAIN-plan gate for new queries, loading/error routes, a11y fixes, design pass.

## Explicitly rejected

- **OpenAPI/tRPC/codegen** — overkill at 30 endpoints and one consumer; hand-written shared types win.
- **An ORM / query builder** — the raw SQL is a feature here (the feature-unit design depends on it);
  the typed `q<T>()` helper is enough.
- **Full RSC conversion of index pages** — SWR pagination with `keepPreviousData` is genuinely the
  better UX for live lists; keep it.
- **Restructuring the indexer** — sync/events/signals layering is correct as-is; only add the
  dependency-graph validation and supply-queue atomicity.
