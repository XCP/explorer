# Assessment-driven refactor plan

Status: active  
Started: 2026-07-12  
Inputs: design review, API architecture assessment, web/OpenNext architecture assessment

## Objective

Use the remaining database-backfill window to make the repository easier to navigate, safer to operate,
and more faithful to its chosen architecture without changing the database migration, public behavior, or
visual design.

## Non-negotiable constraints

- No primary or ledger schema changes while the backfill is active.
- No API deployment while the backfill is active.
- No intentional visual changes.
- No query-shape or response-contract changes hidden inside structural commits.
- Every structural slice must pass typecheck, lint, production Next build, API tests, and relevant browser
  tests before the next slice begins.
- OpenNext deployment artifacts are verified on Linux CI; Windows OpenNext output is best-effort only.

## Priority model

1. Guardrails before movement: exercise the real deployment artifact continuously.
2. Boundaries before folders: server/client, public/admin, and state/storage ownership matter most.
3. Mechanical organization before behavior changes: moves must be independently reviewable.
4. Runtime correctness before optional optimization: React diagnostics precede React Compiler.
5. Defer database-coupled work: runtime DDL removal and schema migrations wait for backfill parity.

## Workstream A — Web and OpenNext

### Now

- Correct the stale web README and generated-file handling.
- Add React Hooks/Compiler-aware linting.
- Add Linux CI gates for Next build, Playwright, and OpenNext transformation.
- Split shared API URL construction, client fetching, and server binding access.
- Generate accurate Cloudflare binding types.
- Establish `components/chrome` and feature ownership with one mechanically moved domain.

### Validate before enabling

- React Compiler: lint, build, profile, browser, and OpenNext comparison first.
- Turbopack and typed routes: separate compatibility experiments.
- OpenNext queue/regional cache: verify current binding/cache behavior first.

### Later

- Convert high-value read-only pages to server-first initial data.
- Split global semantic CSS by component ownership without changing output.
- Revisit Cache Components/PPR after cache ownership is proven.

## Workstream B — API

### Now

- Make unexpected 500 responses generic while preserving detailed structured logs.
- Consolidate operational authentication without abruptly removing unknown query-token callers.
- Add structured request/job logging seams.
- Extract a typed durable indexer-state store and migrate representative crawlers.
- Add tests for state parsing and namespaced keys.

### After backfill

- Deploy and observe boundary changes.
- Migrate known ops callers to bearer authentication, then remove query tokens.
- Move runtime DDL to migrations.
- Extract scheduler job descriptors and normalize provider clients.

## Workstream C — Design-system ownership

### Now

- Keep visual output frozen.
- Move app chrome components together so ownership is obvious.
- Preserve semantic CSS for section chrome and record tables.

### Later

- Split lab-derived global CSS into owned component layers/modules.
- Namespace generic global selectors where collision risk is real.
- Revisit global navigation hierarchy as an intentional design task.

## Definition of done for this window

- Documentation and contributor maps are accurate.
- CI builds what is actually deployed.
- React correctness diagnostics are enabled.
- Server-only Cloudflare code cannot enter client graphs accidentally.
- App chrome and at least one major domain have clear folder ownership.
- API unexpected errors do not expose internal messages.
- Durable indexer state has one typed access path demonstrated by multiple crawlers.
- All checks pass and deferred items state why they were deferred.

