# xcp-explorer — rules for every session

Counterparty explorer. `apps/api` = Cloudflare Worker + D1 (api.xcp.io). `apps/web` = Next.js 15 on
OpenNext/Cloudflare (xcp.io). `packages/shared` = the wire contract. Read
`docs/orientation.md` FIRST (project state: shipped / in-progress / slated + how we work),
and `apps/api/docs/architecture.md` (data architecture) before structural work.

## Hard rules — violations are defects, not style choices

1. **No barrel files.** Never create `index.ts`/`index.tsx` re-export hubs. Import files directly;
   packages expose subpath `exports` (`@xcp/shared/records`, not `@xcp/shared`).
2. **No `any`.** Type D1 results via `q<T>()`/`one<T>()` (`apps/api/src/db.ts`). Type API responses
   with `@xcp/shared` interfaces. If a shape is unknown, define it — that's the job.
3. **Wire ≠ storage.** `packages/shared` holds ONLY what crosses the network. D1 row shapes live in
   `apps/api/src/schema.ts`. Nothing lives in both.
4. **Domain language names things.** The test: what would someone who knows Counterparty but not
   this codebase call it? (`records`, `trades`, `vaults` — yes; `index-names`, `utils`, `helpers`,
   `shared2` — no.) Framework vocabulary (page/hook/component) never names a domain concept.
   Spell out **Counterparty** — never the `Cp`/`CP` abbreviation in identifiers, file names, or
   comments (`parseCounterpartyJson`, not `parseCpJson`). XCP/XCPDEX are product names, not
   abbreviations.
5. **One file, one concept.** A file that needs section-divider comments is several files. Split it.
6. **SQL is private to its owner.** Never share SQL by exporting string fragments across modules.
   Query functions live in `apps/api/src/queries/<domain>.ts` (target layout); handlers do
   parse → query → envelope only.
7. **The Counterparty mirror stays pure.** Indexer event handlers write raw 1:1 capture only.
   Derived data (signals, tags, trades, reputation) lives in its own tables, rebuildable from raw.
8. **New tables get numbered migrations** (`apps/api/migrations-core/`), not just DDL-in-code.

## Definition of done (every change)

- `npm run check` passes at the root (typecheck + lint + structure).
- If you touched the API: `npm test -w xcp-api` passes; hit the affected endpoint locally or on
  prod and eyeball the JSON.
- New/changed response shape → update `@xcp/shared` in the same change.

## Layout (where things go)

- `apps/api/src/read/` — Hono route modules (thin). `src/queries/` — the SQL (typed functions).
  `src/indexer/` — the three indexers (Counterparty replayer + events/, Emblem crawler, Emblem
  sales) and derived builders (signals, tags, trades, prices). `src/reputation/` — pure scoring
  (config.ts is the tuning surface). `src/schema.ts` — storage row types. `ops/` — runbooks/scripts.
- `apps/web/src/lib/` — `api.ts` (client), `registry.tsx` (record catalog → columns/routes),
  `format.ts`. `src/components/` — flat; split `ui.tsx` concerns into `ui/` (no index file).
- `packages/shared/src/` — one file per domain: records, chain, assets, addresses, trades, stats,
  emblem, envelope.

## Operational facts

- Worker `xcp-api`, D1 db `xcpio`, live at https://xcp-api.me-bbe.workers.dev; web reads it via
  `NEXT_PUBLIC_API_BASE`. Cron ticks every 2 min (`src/index.ts` scheduled handler).
- The compact replay lock serializes scheduled and manual sync invocations.
- Never commit token files (`.tt`, `.salestok` are gitignored admin tokens).
