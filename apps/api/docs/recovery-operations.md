# Recovery operations

Recovery is a native API Worker workload. The scheduled Worker incrementally scans canonical Counterparty
transactions, reconciles recovery attempts against Electrs, and refreshes aggregate statistics. Durable state
lives in the recovery D1 database and transaction evidence lives in R2. No source server, private bootstrap
Worker, daemon, or local checkpoint is part of production operation.

## Runtime ownership

- `src/scheduler/recovery-maintenance.ts` schedules bounded scan, attempt reconciliation, and statistics work.
- `src/recovery/scanner.ts` discovers recoverable bare-multisig outputs from canonical transactions.
- `src/recovery/repository.ts` owns recovery D1 reads and writes.
- `src/routes/recovery.ts` serves the public recovery API.
- `src/recovery/admin.ts` exposes token-protected verification and repair controls.
- `migrations-recovery` is the complete, replayable schema history.

The scanner cursor is stored in D1. A failed tick leaves the cursor at the last completed boundary, so the next
scheduled invocation resumes safely. Writes are idempotent; operators should not delete rows before retrying.

## Routine checks

Use the protected live-status and verification endpoints to check the scan cursor, chain reconciliation,
readiness gates, and aggregate freshness. Compare the scanner cursor with the canonical transaction tip before
calling the dataset current. A temporary lag is expected because each scheduled invocation has a bounded
provider and CPU budget.

Run the recovery migration rehearsal before deployment:

```sh
npm --workspace apps/api run test:migrations:recovery
```

This replays the schema from scratch and exercises the supported upgrade path using the production Worker
configuration. Migration files are permanent history and must not be edited or removed after deployment.

## R2 integrity audit

The R2 auditor is retained as an explicit integrity tool, not a continuously running service. It checkpoints
after every page and retries timeouts, rate limits, and server errors with bounded exponential backoff.

After loading the protected environment, run `node ops/audit-recovery-r2.mjs` from `apps/api`. Restarting with
the same checkpoint resumes after the last accepted transaction. Never place bearer tokens in command
arguments, logs, or repository files.

## Historical import

The source-host import is complete and retired. Its accepted rows, receipts, provenance, readiness state, and R2
evidence remain durable data. Ongoing discovery now comes exclusively from the canonical database scanner.
Restoring the old host-side exporter or standalone bootstrap Worker is not a recovery procedure.
