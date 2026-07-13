# Compact core migration

The migration produces one canonical `xcpio-core` database with every source relation represented. It is a
normalization and encoding change, not a partial mirror: source tables are either preserved, compacted into a
corresponding table, or deliberately merged according to the closed manifest in
`apps/api/src/indexer/core-manifest.ts`.

## Pipeline

1. Capture one consistent source export. The HTTP snapshot crawler is useful for sizing and rehearsals, but it is
   not a canonical source because production changes while it runs.
2. Import the export into a local SQLite snapshot with `snapshot:core:import`.
3. Build a new compact SQLite file with `build:core`. The builder refuses an existing output, an incomplete
   snapshot, or an inconsistent snapshot. All transforms run against one read transaction.
4. The builder compares every source relation with its target, including the merged credit/debit ledger, and
   verifies transaction-hash decoding. Only then does it write `build_complete=1`.
5. Generate bounded, convergent SQL chunks with `build:core:sql`, then verify their sizes, hashes, statement
   limits, and final gate with `build:core:sql:verify`.
6. Apply `migrations-core` to a fresh D1 database and run `import:core:sql`. The importer refuses a nonempty
   target on its first run. It checkpoints each exact chunk hash and safely resumes with upserts.
7. The final chunk writes `import_complete=1`. Operational readiness requires `build_complete`,
   `snapshot_consistent`, and `import_complete`; an interrupted import cannot satisfy that gate.
8. Run schema coverage, row-count, representative query, and API contract checks against the completed database
   before changing the Worker binding.

## Application cutover

Import completion proves storage parity; it does not by itself move application traffic. The application cutover
has three explicit workstreams:

1. Port public queries to the compact base tables. Resolve asset/address strings to dictionary ids first, seek and
   paginate indexed rows second, and decode only the selected page. App-specific tables preserved without a shape
   change can move directly.
2. Add native compact event writes and a cursor starting at the source snapshot's event frontier. Catch that cursor
   up from Counterparty before switching scheduled indexing, so events created during export/build/import are not
   lost.
3. Compare old and compact response envelopes at the first, middle, and last pages, then switch reads and scheduled
   writes together. Keep the source binding available for a bounded rollback window; removing it is a later,
   separately verified operation.

The cutover is complete only when both reads and forward writes use the compact schema. Until then, `xcpio-core` is
a validated candidate rather than the production source of truth.

## Commands

Run from the repository root. Use absolute paths so a resumed operation cannot resolve a different artifact.

```powershell
$env:CORE_SNAPSHOT_PATH = "C:\path\source.sqlite"
$env:CORE_COMPACT_PATH = "C:\path\compact.sqlite"
npm run build:core -w xcp-api

$env:CORE_SQL_DIRECTORY = "C:\path\compact-sql"
npm run build:core:sql -w xcp-api
npm run build:core:sql:verify -w xcp-api

$env:CORE_D1_DATABASE = "xcpio-core-candidate"
$env:CORE_IMPORT_STATE = "C:\path\xcpio-core-candidate-import.json"
npm run import:core:sql -w xcp-api
```

The target must be a freshly migrated database. This avoids delete-and-repopulate behavior and guarantees that
upserts cannot leave rows behind from an older dataset. The existing production database remains available until
the completed database has passed validation and the binding is changed.
