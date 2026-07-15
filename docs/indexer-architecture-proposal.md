# Indexer and Data Architecture Proposal

Date: 2026-07-15

## Executive conclusion

The canonical database architecture is sound. The normalized D1 database is approximately 4.14 GB, is the only explorer read source, and has durable cursors and idempotent writers. The next phase should not be another database redesign. It should make the existing system cheaper to operate, easier to observe, and less vulnerable to one slow maintenance task delaying everything behind it.

The highest-value work is:

1. Replace repeated missing-row discovery scans with durable work cursors or indexed queues.
2. Split live ingestion from independently scheduled maintenance classes.
3. Give every long-running job one typed, queryable lifecycle record.
4. Fix the few production query shapes proven expensive by D1 Insights.
5. Retire completed migration machinery on an explicit checklist.

## What is already right

- `xcpio-core` is canonical. Explorer reads do not fall back to the retired source database.
- Protocol tables are normalized around integer dictionary identifiers, keeping the database well below D1's 10 GB limit.
- Indexer writes are generally bounded, resumable, and idempotent. Upserts are used for convergence rather than delete-and-replace rebuilds.
- Read-oriented projections (`trades`, signals, tags, daily metrics, network snapshots) keep expensive interpretation out of request paths.
- Offset pagination remains available where users need direct first/last-page navigation.
- Query code is separated under `queries/`; external access is isolated under `integrations/`.
- The repository already enforces TypeScript, ESLint, Prettier, kebab-case filenames, path aliases, direct imports/no barrels, and provider isolation in CI.
- Recovery has its own storage because its UTXO verification workload and retention model differ from the canonical protocol mirror; it is not a second version of the core schema.

## Evidence from production

D1 Insights for the preceding 24 hours identified these material costs:

| Work                                               | Runs | Average rows read | Total rows read | Total duration |
| -------------------------------------------------- | ---: | ----------------: | --------------: | -------------: |
| Discover blocks missing Bitcoin transaction counts |  503 |           679,870 |     341,974,775 |          159 s |
| `ANALYZE`                                          |    2 |       168,103,939 |     336,207,878 |          140 s |
| DEX trade reconciliation                           |  909 |           199,625 |     181,459,392 |          332 s |
| Emblem vault/send classification                   |   82 |         2,129,748 |     174,639,337 |           20 s |
| Low-quality network totals                         |   10 |        11,399,359 |     113,993,598 |           96 s |
| Ordinary asset lookup                              |  152 |           507,235 |      77,099,742 |            8 s |

These numbers distinguish four different situations:

- The missing-block query is avoidable orchestration waste.
- The asset lookup is an avoidable query-shape issue: `asset = ? OR asset_longname = ?` prevents two efficient indexed probes.
- The trade and quality-stat queries are legitimate projection work, but are running more often or over broader ranges than necessary.
- `ANALYZE` is expensive by nature and valuable when statistics are stale; it should be triggered by evidence or meaningful data growth, not merely elapsed blocks.

## Lessons confirmed against Counterparty Core

Recent upstream performance work supports the same direction while operating in a different runtime:

- PRs [#3443](https://github.com/CounterpartyXCP/counterparty-core/pull/3443), [#3444](https://github.com/CounterpartyXCP/counterparty-core/pull/3444), and [#3445](https://github.com/CounterpartyXCP/counterparty-core/pull/3445) bound cached work by retained rows and cache the fully enriched response. Our Worker already caches serialized, ready-to-serve JSON at the edge and in D1, so it should not copy Counterparty's process-local cache. The transferable rule is to keep cache keys low-cardinality, cache after enrichment, and measure retained response size rather than only entry count.
- PR [#3450](https://github.com/CounterpartyXCP/counterparty-core/pull/3450) rewrites filters on decoded views into indexed predicates against normalized base tables. Our query review should enforce the same invariant: resolve public strings to dictionary IDs first, then filter the base table by its indexed integer columns.
- PR [#3442](https://github.com/CounterpartyXCP/counterparty-core/pull/3442) serves event counts from an incrementally maintained count table. Our `network_stats_snapshot`, asset feed counts, and daily metrics apply this pattern already; quality-filtered totals are the clearest remaining place to extend it.
- PR [#3251](https://github.com/CounterpartyXCP/counterparty-core/pull/3251) shows why expressions around indexed identity columns can silently force scans. Query-plan and D1 Insights regression checks should accompany identity lookup changes.

These are principles to apply to the canonical schema, not compatibility layers or copies of Counterparty's Python architecture.

Four incident-driven issues opened on 2026-07-15 add an important overload dimension:

- [#3459](https://github.com/CounterpartyXCP/counterparty-core/issues/3459) requires bounded backend retries and circuit breaking. Our public Counterparty read-through calls already use an eight-second timeout and zero retries, but the shared provider client previously allowed the aggregate retry sequence used by background jobs to run for several minutes. It now needs a total deadline, bounded `Retry-After`, and jitter; scheduler isolation remains necessary because background correctness retries have different policy from public requests.
- [#3460](https://github.com/CounterpartyXCP/counterparty-core/issues/3460) isolates health checks from a saturated synchronous worker pool. Cloudflare Workers do not share Counterparty's fixed Waitress pool, and `/health` performs no dependency calls, so the exact failure mode does not transfer. We should nevertheless keep liveness dependency-free and add a separate bounded readiness/status signal rather than turning `/health` into a database/provider fan-out.
- [#3461](https://github.com/CounterpartyXCP/counterparty-core/issues/3461) adds server-side cost guards. Public explorer pages are already clamped to 100 rows by default (200 for trades and explicitly bounded graph views), and Bitcoin read-through calls are single-transaction operations. We should mechanically inventory every public route, document exceptions, and test maximum result/fan-out budgets so a later endpoint cannot bypass those guarantees.
- [#3462](https://github.com/CounterpartyXCP/counterparty-core/issues/3462) disables Counterparty's legacy JSON-RPC API. We expose no generic JSON-RPC or user-selectable SQL/operation proxy. Our `/api/v1` wallet routes are our own current extension contract, not Counterparty's legacy API, so renaming or removing them based on this issue would be a category error.

## Priority 0: finish current operations safely

### Bitcoin transaction fees

Allow the current resumable backfill to continue. Do not restart it merely to improve its implementation. It currently has 636,516 of 3,146,716 rows populated and is constrained primarily by upstream 429/503 responses.

After it reaches zero missing rows:

1. Verify null count, non-negative fees, sampled transactions against Bitcoin data, and aggregate fee totals.
2. Apply migration `0034_finalize_bitcoin_transaction_fees.sql` once.
3. Verify the rebuilt triggers, daily metrics, and network snapshot.
4. Delete the temporary `/admin/bitcoin-fees` endpoint, exporter/backfill script, local logs, and fee-specific deployment instructions.
5. Retain only the permanent newest-transaction reconciliation job and migration history.

### Block transaction counts

Stop scanning the entire `blocks` table every two minutes. Preserve the current run's work, then switch to a durable descending historical cursor plus a small newest-block frontier. Historical work advances monotonically; the frontier repairs recent gaps. A partial index on missing rows is an acceptable alternative, but a cursor avoids maintaining a large temporary index after completion.

## Priority 1: scheduler architecture

The current even-minute cron awaits roughly 25 maintenance jobs serially after ingestion. `runScheduledJob` isolates exceptions, but it does not isolate latency: a slow provider call delays every job after it. The comments and block-gating logic in `index.ts` are effectively an informal scheduler.

Create a declarative job registry with these fields:

- stable job name;
- workload class (`ingest`, `projection`, `provider`, `repair`);
- cadence and bounded work budget;
- readiness predicate;
- cursor/state codec;
- timeout and retry policy;
- whether concurrent execution is safe.

Run live Counterparty ingestion on its own cron. Run D1-only projections in a separate write lane. Run external-provider crawls independently so Alchemy, Electrs, Sequence, Scarce, or Counterparty throttling cannot starve core maintenance. Initially this can be separate Cloudflare cron expressions rather than introducing Queues. Add Queues only if durable per-item delivery is demonstrably needed.

Keep D1 writers intentionally bounded and mostly serial within their lane; parallelizing writes against the same SQLite primary would exchange latency for contention.

## Priority 1: one durable job model

Raw `core_state` string keys are compact but do not answer basic operational questions consistently. Missing keys are ambiguous: not started, complete, misconfigured, or renamed can look identical.

Add a `job_state` table (or evolve `core_state` once, without versioned names) with:

- `job` primary key;
- `phase`: `backfill`, `maintenance`, `complete`, `retired`, or `error`;
- typed cursor serialized in a documented form;
- `last_started_at`, `last_succeeded_at`, and `updated_at`;
- `items_read`, `items_written`, and optional `items_remaining`;
- `consecutive_failures` and bounded last-error metadata.

Expose one authenticated status endpoint generated from this registry. A job is stalled when it remains in an active phase without cursor movement for its expected cadence. This replaces process inspection, log-file archaeology, and guessing from absent keys.

## Priority 1: proven query fixes

1. **Asset lookup:** resolve `asset_dictionary.asset` first; if absent, probe the unique `assets.asset_longname` index. Avoid the cross-table `OR`. This should turn a roughly 507k-row average read into two indexed lookups.
2. **Block-count work discovery:** use the durable cursor/frontier described above instead of `COUNT(*)` plus `MAX()` across every missing block on every tick. Compute progress periodically, not as part of every work claim.
3. **Quality network totals:** materialize the clean totals when asset quality changes, rather than rebuilding unions across protocol tables on a request or frequent refresh. Quality changes are rare compared with reads.
4. **DEX reconciliation:** live ingestion should advance only the new range. Run cyclic historical self-healing at a lower cadence and smaller explicit budget. Track whether each sweep writes anything; automatically widen its interval after clean sweeps.
5. **Emblem classification:** drive work from changed vault identifiers instead of joining a vault rowid window against the full sends history. Maintain a durable dirty-vault queue populated by vault and send ingestion.
6. **`ANALYZE`:** retain it, but gate it on material row growth, schema/index migration, or observed plan regression. Record its last duration and database row baseline. A weekly full run that reads 168 million rows can be justified, but twice in one day cannot.

Before adding any new index, compare D1 Insights and `EXPLAIN QUERY PLAN`, estimate index storage/write amplification, and record the before/after result in `docs/query-perf.md`.

## Priority 2: correctness and resilience

- Add scheduler tests proving provider failure does not block unrelated work.
- Add cursor invariants: successful cursors are monotonic; a cursor advances only after its writes succeed; replaying a window is a no-op.
- Add reorg tests for canonical ingestion and every projection derived from block ranges.
- Add fixtures for Counterparty one-to-many behavior: multi-asset dispenses remain bundles with trade legs and never become duplicate single-asset sales.
- Add provider contract tests for 429, 503, malformed JSON, partial batch responses, timeouts, and circuit-breaker recovery.
- Sample canonical rows against Counterparty on a schedule and compare derived Bitcoin facts against an independent Bitcoin source.
- Capture D1 metadata (`rows_read`, `rows_written`, duration) per scheduled job where available. Alert on sudden read amplification, repeated zero-progress runs, and failure streaks.

## Priority 2: organization without ornamental indirection

`src/index.ts` should remain the composition root, but scheduler policy and individual cadence wrappers should move into `src/scheduler/registry.ts` and workload-specific schedule modules. Route mounting and Worker lifecycle stay in `index.ts`.

Split `admin.ts` by operational domain only when doing so gives clear ownership: status, verification, recovery, and temporary migration operations. Do not split files to satisfy a line limit. Continue direct imports and existing `#api` aliases; do not add barrels.

Centralize provider behavior—not provider data models—around a small shared resilience layer for timeout, retry classification, backoff, request identifiers, and redacted error reporting. Keep each provider adapter explicit because their pagination and consistency contracts differ.

## Priority 3: lifecycle and repository cleanup

Define three categories:

- **Permanent runtime:** live ingestion, current projections, recovery maintenance, provider adapters.
- **Finite operation:** a backfill with an owner, exit condition, status record, verification, and deletion checklist.
- **Historical migration:** immutable SQL already applied; retained because it explains and reproduces schema evolution.

Delete finite-operation code after its verified exit condition. Do not squash applied D1 migration history, because fresh-database reproducibility and Cloudflare's migration ledger depend on it. Instead, create and continuously test a canonical bootstrap path that applies all migrations to an empty local D1 database and validates the final schema. Local log files, orphan processes, obsolete import scripts, and temporary admin routes are not migration history and should be removed.

## Recommended execution order

1. Let active fee and block-count work continue; add no disruption to the running fee process.
2. Fix the asset lookup query and block-count work discovery, with D1 before/after measurements.
3. Introduce the typed job registry/status model and migrate one job end to end.
4. Split ingestion, D1 projection, and external-provider schedules.
5. Move quality totals and Emblem classification to dirty-set maintenance.
6. Reduce cyclic reconciliation frequency using measured write yield.
7. Finalize Bitcoin fees and delete their temporary machinery.
8. Run the retirement audit: no source DB binding, no fallback/adapter flags, no temporary admin endpoints, no orphan import processes, and a passing empty-database bootstrap test.

## Success criteria

- Canonical API behavior and direct page navigation remain unchanged.
- A failing external provider cannot delay canonical ingestion or unrelated projections.
- Every active job has an unambiguous phase, cursor, last success, progress, and failure count.
- The top production query list contains no repeated full-table work-discovery scans.
- Point asset lookup uses indexed probes and reads orders of magnitude fewer rows.
- Reconciliation jobs have measured yield and adapt their cadence when repeatedly clean.
- Completed backfills leave migration history and tests, but no runtime endpoints, scripts, logs, feature flags, adapters, or alternate read paths.
