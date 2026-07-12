# API architecture assessment

Status: assessment only  
Reviewed: 2026-07-12  
Scope: `apps/api`, its shared contracts, Worker configuration, D1 access, scheduled jobs, and tests

## Executive assessment

The API has a sound architecture underneath substantial operational growth. Its strongest choices are
the explicit read/write separation, domain query modules, deterministic event replay, shared wire DTOs,
prepared D1 statements, bounded background work, and pure reputation policy modules. This is not a
codebase that needs a framework rewrite or an ORM imposed on it.

The main maintainability problem is uneven convergence on that architecture. The read side is close to
the documented target; the scheduler, admin surface, state management, upstream clients, runtime
validation, and schema ownership are still organized as accumulated capabilities. The result remains
legible to its author, but too much system knowledge is encoded in comments, string keys, repeated
helpers, casts, and one large composition root.

Overall: **good architecture, incomplete standardization**. Preserve the model; strengthen its seams.

## Current system model

```text
HTTP fetch
  Hono composition root
    public read routers -> query modules -> D1 / service bindings
    operational routers -> indexer/build functions -> D1
    compatibility routes -> consolidation/service proxies

scheduled event
  scheduler policy
    Counterparty event replay -> canonical mirror
    dirty-set projections -> signals/tags/trades
    bounded external crawlers -> Emblem/collections/prices
    periodic global maintenance -> graph/ANALYZE/self-heal

wire contract
  packages/shared DTOs <- API route results -> apps/web
```

That is the correct macro-architecture for this product. A rich domain-object layer would add ceremony
without protecting meaningful invariants; the chain already supplied those invariants. SQL-centric
query modules and projection builders are appropriate for D1.

## What is already strong

### 1. The architectural intent is explicit

`docs/architecture.md` gives the system a useful language: canonical capture, derived projections,
periodic globals, and read-time scoring. The distinction between authoritative mirror data and
rebuildable features is especially valuable. It gives future work a clear placement test.

### 2. Read organization is close to exemplary

The `read/` and `queries/` split establishes a good default:

- route modules own HTTP parsing, composition, cache policy, and envelopes;
- query modules own SQL and return typed rows/DTOs;
- `db.ts` centralizes the small typed D1 result helpers;
- wire shapes live in `@xcp/shared` rather than being recreated in each app.

This is more maintainable than either SQL embedded in every handler or a generic repository abstraction.
The domain-oriented names (`addresses`, `assets`, `trades`, `vaults`) are easy to navigate.

### 3. The Worker/D1 technology choices fit the workload

Hono is thin and Web-standards-native. D1 prepared statements and explicit SQL suit an explorer whose
performance depends on deliberate indexes and query plans. Service bindings are used where Worker-to-
Worker composition matters. The Sessions API middleware correctly opts stale-tolerant reads into D1
replication semantics.

### 4. Indexing work is operationally mature

Important production lessons are captured in code: bounded work per cron, replay idempotency, reorg
handling, sync locking, recompute-over-delta, dirty-set cascades, backfill cursors, retry limits, and
timeouts. These are the hard parts of an explorer, and the code generally treats them seriously.

### 5. Numerical correctness receives unusual care

Large Counterparty integers are parsed and tested explicitly. `bigint` is retained where needed, public
normalization is deliberate, and query fixtures pin compact-schema identities and query plans.

### 6. Tests cover the riskiest pure logic and storage invariants

The suite includes precision tests, scoring tests, graph adversarial tests, compact-schema constraints,
query-plan assertions, projection parity, live DTO contracts, and browser smoke tests outside the API.
That is a strong risk-oriented foundation.

## Findings and recommendations

Priorities mean architectural importance, not permission to refactor everything at once.

### P0 — Secure and normalize the operational boundary

The admin router accepts `Authorization: Bearer`, but retains a `?token=` fallback; `verify.ts` still
uses query tokens directly. Query secrets leak into browser history, access logs, analytics, copied URLs,
and intermediary telemetry. The fallback also duplicates authorization logic.

Target:

- one `requireAdmin` Hono middleware, shared by all operational and verification routes;
- bearer header only;
- constant-time token comparison where practical;
- return 401 for missing/invalid authentication, with `WWW-Authenticate`, rather than scattered 403s;
- keep `/admin/*` entirely outside public CORS/cache middleware;
- validate every admin query/body before invoking expensive work.

Do this as a controlled ops migration: update scripts first, observe usage, then remove query-token support.

### P0 — Do not expose unexpected exception messages

The top-level error handler returns `err.message` for unexpected 500s. D1/upstream exceptions can expose
SQL fragments, binding details, URLs, or implementation state. Expected client errors should retain a
safe public message; unexpected faults should return a stable generic code/message and log the detailed
cause internally.

Use a small error taxonomy (`ApiError`/`HTTPException` for expected faults) and a structured error
envelope such as `{ error: { code, message, request_id } }`. Keep the present wire shape temporarily if
changing it would break consumers.

### P1 — Extract scheduler policy from the composition root

`src/index.ts` currently defines bindings, middleware, routes, cadence gates, and the full scheduled job
graph. The scheduled handler is a long sequence of independent `try/catch` blocks. This has useful fault
isolation, but no reusable job model, consistent timing, outcome reporting, deadline/budget policy, or
single inventory of dependencies and cadences.

Target structure:

```text
src/
  app.ts                  create and configure the Hono app
  worker.ts               fetch/scheduled exported handler only
  env.ts                  generated bindings plus semantic config types
  scheduler/
    run-scheduled.ts      orchestration and total budget
    jobs.ts               typed job registry
    cadence.ts            block/time gates
```

A job descriptor should carry a stable name, phase, caught-up requirement, cadence, and `run(env)`.
The runner should emit a structured result with duration/outcome and continue according to explicit
failure policy. Keep strict ordering only where a dependency actually exists; do not blindly parallelize
D1-heavy work.

### P1 — Centralize durable state access and type its keys

Near-identical `getState`/`setState` functions exist across Emblem, graph, signals, prices, trades,
vaults, and sales crawlers. Each caller reparses strings and hand-types keys such as
`"emblem_sales_idx"` or `"signals_cascade_block"`. This is the clearest repeated infrastructure seam.

Introduce an `IndexerStateStore` over a `D1Database` with:

- `getString`, `getInt`, `getJson`, `set`, `delete`;
- safe parse behavior and optional schema/version checks for JSON values;
- prepared statement construction in one place;
- a namespaced key catalog or helpers (`stateKeys.emblemSalesCursor(contract)`);
- a separate instance/table name for ledger state.

Avoid a general database repository. This abstraction is justified because it represents one real,
repeated concept: durable resumable-job state.

### P1 — Put all persistent schema under migrations

The project correctly has sequential D1 migrations, but several indexers still export or execute
`CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` strings. Runtime DDL makes the effective
schema harder to audit, reproduce locally, and compare with production. It also weakens the claim that
migrations are the schema history.

Move signal, Emblem, price, and sales table/index creation into migrations. Projection modules should
own data derivation, not schema installation. A temporary `ensureSchema` path is acceptable only for a
bounded migration window and should have an explicit removal issue/date.

### P1 — Validate untrusted data at runtime

TypeScript assertions do not validate runtime data. External JSON is commonly written as
`(await response.json()) as SomeShape`; event payloads enter as `any`; admin JSON is only partially
checked; route pagination uses permissive `parseInt` helpers. Upstream drift can therefore become silent
nulls, malformed projection rows, or confusing errors far from the boundary.

Use lightweight runtime schemas at boundaries, not throughout internal code:

- admin JSON/query/param validation through Hono validator middleware;
- Counterparty envelope/event validation at the client boundary;
- third-party clients validate only the fields they consume;
- parse pagination once with finite-integer rules and explicit bounds;
- model optional secrets as optional in `Env` rather than casting `Env` back to optional shapes.

A Standard Schema library such as Valibot or Zod is appropriate. Do not schema-validate every trusted D1
row on every read; that would add cost without proportional value.

### P1 — Turn upstream integrations into explicit clients

Timeouts have improved, but fetch/parsing/retry/error conventions still differ between Counterparty,
Alchemy, Etherscan, Sequence, Scarce City, pepe.wtf, and metadata fetches. Some integrations throw,
others return `[]`, some return `{ skipped }`, and some silently preserve prior data.

Create small integration clients grouped by provider or capability:

```text
src/integrations/
  counterparty/client.ts
  alchemy/client.ts
  sequence/client.ts
  scarce-city/client.ts
```

Each client should own URL construction, timeout, retry/backoff, status checking, response validation,
and a typed provider error. Indexers should own cursor semantics and database writes. Preserve the useful
domain-specific rule that a transient listing failure must not prune known listings.

### P1 — Enable first-class Workers observability

The code logs many scheduler failures as human strings, but `wrangler.toml` does not declare current
Workers observability/tracing configuration. Production scheduling is otherwise difficult to assess:
there is no consistent job duration, outcome, cursor movement, D1 work, or request correlation field.

Add:

- Workers Logs and sampled traces in Wrangler;
- structured object logs rather than concatenated strings;
- a request ID surfaced in errors and logs;
- one event per scheduled job containing job, duration, outcome, cursor/progress, and error category;
- alerts for sync lag, repeated job failures, backfill stalls, cron CPU exhaustion, and parity failures.

Cloudflare currently recommends keeping compatibility dates current and enabling logs/traces for
production Workers. Treat compatibility-date updates as tested dependency upgrades, not incidental edits.

### P2 — Separate storage rows, wire DTOs, and upstream DTOs more visibly

`schema.ts` is a reasonable start, but its name is ambiguous: it is TypeScript storage-row interfaces,
not the authoritative D1 schema. Rename toward `storage-types.ts` or place types beside their owning query
modules. Use consistent suffixes:

- `*Row` for D1 rows;
- `*Dto` or the existing semantic shared name for wire contracts;
- `*Response`/`*Event` for upstream payloads;
- `*Result` for use-case/indexer outcomes;
- `*Config`/`*Options` for inputs.

Avoid exporting implementation DDL constants from indexers. Export behavior and domain result types.

### P2 — Reduce large-file concept density

Line count alone is not a defect, but several files combine distinct reasons to change:

- `signals.ts`: table DDL, feature registry, SQL units, state access, full runner, cascade runner;
- `read/assets.ts`: detail composition, scoring, calibration endpoints, metadata proxy, market adapter;
- `queries/assets.ts`: many independent asset subdomains;
- `sync.ts`: HTTP traversal, locks, ledger backfill, event application, reorg rollback;
- `admin.ts`: authentication plus every operational command.

Split by capability, not arbitrary line count. For example, preserve a public `signals/index.ts` facade
while separating feature definitions, cascade discovery, and runners. Keep related SQL beside the query
that owns it.

### P2 — Make naming reflect the product and architectural roles

The workspace package was renamed from `xcpdex-api` to `xcp-api` during the assessment refactor so npm
commands, CI, the Worker, and the explorer API now use the same identity. The separate `XCPDEX` service
binding retains its own name because it refers to the market-data Worker.

Other naming guidance:

- prefer `routes/` over `read/` if the folder contains HTTP adapters, or retain `read/` but document it as
  the CQRS read interface; consistency matters more than either word;
- replace generic helpers such as `J`, `q`, and `one` with `jsonOk`, `queryAll`, and `queryOne` if readability
  for new contributors outweighs brevity;
- use `list/get/find` consistently: `get` expects one, `find` may return null, `list` returns arrays;
- name cadence constants (`BLOCKS_PER_DAY`, `ANALYZE_INTERVAL_BLOCKS`) instead of repeating 144/1008/6;
- centralize timeout and batch-size constants by integration/job, while keeping query-specific limits local.

### P2 — Strengthen route-level and Worker-runtime tests

Current tests are strongest around pure logic and SQLite fixtures. Add a smaller number of high-value
adapter tests using Hono's `app.request()` and Cloudflare's Workers Vitest pool:

- authentication and secret non-leakage;
- pagination validation and error envelopes;
- cache headers/HIT behavior;
- admin body validation;
- upstream timeout/non-2xx/malformed JSON behavior;
- scheduled job ordering, caught-up gating, and fault isolation;
- D1 local migrations as the complete schema source.

Keep the existing Node tests where they are fast and effective. This is additive, not a wholesale test
framework migration.

### P3 — Review configuration and generated types

The `compatibility_date` is `2025-01-01`, substantially behind the reviewed runtime date. Update it on a
regular, tested cadence. Consider `wrangler types` as the source of binding types rather than a fully
manual `Env`, then add a semantic config layer that distinguishes required public variables from optional
provider secrets.

Do not add `nodejs_compat` merely because it is commonly recommended; enable it only if dependencies or
desired Node APIs require it. The current code is appropriately Web-standards-oriented.

## Constants and configuration policy

Use this placement rule:

- **Protocol fact:** named beside the protocol parser/handler and linked to the source.
- **Provider constraint:** named in the provider client (`SEQUENCE_PAGE_SIZE`, timeout, retry ceiling).
- **Operational tuning:** named in scheduler/job config and observable at runtime.
- **Scoring policy:** remains in `reputation/config.ts`.
- **Schema invariant:** enforced by migration/constraint/index, then mirrored by a narrow TypeScript type.
- **One-use obvious literal:** keep local; not every number deserves a constant.

Avoid a single `constants.ts`. It becomes an unowned junk drawer and separates values from their meaning.

## Type policy

1. `unknown` at untrusted boundaries.
2. Validate/narrow once, near entry.
3. Storage rows and wire DTOs remain distinct even when currently identical.
4. Prefer discriminated unions for job/provider outcomes over loose records.
5. Use `0 | 1` only for actual SQLite boolean storage rows; expose `boolean` in application/wire models
   when the contract permits it.
6. Retain `bigint` or decimal strings for quantities that can exceed JavaScript safe integers.
7. Do not use a cast to make an optional binding appear optional; type it correctly in `Env`.
8. The dynamic Counterparty event seam may remain `unknown` plus per-handler narrowing. A global `any`
   payload forfeits exactly the protection TypeScript should provide at the most variable boundary.

## Recommended target layout

This is a direction, not a one-shot move:

```text
apps/api/src/
  worker.ts
  app.ts
  env.ts
  middleware/
    admin-auth.ts
    errors.ts
    read-cache.ts
    d1-session.ts
  routes/
    public/<domain>.ts
    admin/<capability>.ts
    compatibility/<surface>.ts
  queries/<domain>.ts
  indexer/
    counterparty/
      sync.ts
      reorg.ts
      events/
    projections/
      signals/
      tags/
      trades/
    crawlers/
      emblem/
      collections/
      prices/
  integrations/<provider>/client.ts
  scheduler/
    jobs.ts
    run-scheduled.ts
  storage/
    d1.ts
    indexer-state.ts
    row-types.ts
  reputation/
```

Do not perform a directory big bang. Establish target seams with new work, then move one coherent domain
at a time with behavior pinned by tests.

## Suggested sequence

1. Add structured observability and safe unexpected-error responses.
2. Consolidate admin authentication; remove query tokens after ops migration.
3. Add runtime validation for admin and upstream boundaries.
4. Extract and type the indexer-state store.
5. Move runtime DDL into migrations and add a schema-completeness test.
6. Extract scheduler/job registry from `index.ts` with unchanged ordering.
7. Normalize provider clients and outcomes.
8. Split the largest multi-concern modules opportunistically.
9. Align package/service naming.

Each step should be independently deployable and should not alter public results unless explicitly
planned. Avoid combining structural movement with query/schema changes in the same commit.

## Practices not recommended here

- Do not introduce an ORM solely to appear modern; explicit SQL is a performance and clarity advantage.
- Do not create repositories for every table.
- Do not force all routes into Hono RPC if shared DTOs and external compatibility matter more than an
  inferred internal client.
- Do not hide D1 batching, indexes, or query plans behind generic data-access abstractions.
- Do not split every file below an arbitrary line threshold.
- Do not parallelize scheduled jobs without modeling D1 contention and dependencies.
- Do not replace durable D1 cursors with in-memory Worker state.

## Reference guidance

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Cloudflare D1 read replication and Sessions API](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Hono validation](https://hono.dev/docs/guides/validation)
- [Hono testing](https://hono.dev/docs/guides/testing)
- [Hono error handling](https://hono.dev/docs/api/exception)
