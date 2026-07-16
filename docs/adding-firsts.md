# Adding a historical first

The Firsts page is generated from `apps/api/src/queries/firsts.ts`. Each catalog entry is an independent SQL query that derives one milestone from canonical Counterparty history. The API runs the queries concurrently, then sorts the results by block.

## Query contract

Every query must return exactly these aliases:

| Alias | Meaning |
| --- | --- |
| `b` | Counterparty block index |
| `t` | Unix block time |
| `ref` | Human-readable subject, such as an asset, address, pair, or block |
| `typ` | Subject type: `asset`, `address`, `pair`, `broadcast`, `summary`, `block`, or `tx` |
| `tx` | Lowercase, 64-character causal Bitcoin transaction hash |

Only the literal **First transaction** may use a transaction hash as `ref`. Every other row displays the thing that was first and links that subject to its causal transaction.

## Preferred query builders

- `earliestEventSql` handles ordinary event tables. Pass `valid: true` whenever the table has a Counterparty `status` column.
- `earliestValidIssuanceSql` finds the first valid issuance that actually established an asset property. Do not infer a historical first from today's `assets` row.
- `earliestLockedSupplySql` reconstructs cumulative supply at the locking event for supply-sensitive milestones such as the first 1/1.

Use a custom query only when these builders cannot express the relationship clearly. Keep it beside the related catalog entries and explain any non-obvious protocol rule in a comment.

## Evidence rules

1. Derive the result from a general condition, not a known asset name, transaction hash, block, or date.
2. Exclude invalid protocol records. A later invalid issuance must never create or alter a first.
3. Use immutable event history rather than current state when a property can change over time.
4. Order deterministically by block and then the table's transaction/event index.
5. Link the exact transaction that caused the milestone.
6. Verify the field semantics and one-to-many relationships against Counterparty Core source.
7. Treat a curated community classification as an explicit exception. Document why it cannot be derived from Counterparty data alone. The canonical Stamp #0 entry is the current example.
8. Avoid novelty thresholds and arbitrary set pieces. A first should identify a protocol capability, meaningful state transition, or durable cultural milestone.

## Pull-request checklist

1. Add the catalog entry in the relevant commented section of `firsts.ts`.
2. If its source has `status`, add its key to `STATUS_BACKED_FIRSTS` in `apps/api/tests/core-firsts-validity.test.ts`.
3. Add a focused contract assertion for a new category or invariant; do not pin the entire response to a historical answer unless the entry is explicitly curated.
4. Run `npm run typecheck` and `npm test -w xcp-api`.
5. Inspect the query plan and D1 rows read. If SQLite scans a large event table or creates a temporary sort tree, add a narrow migration index justified by that query.
6. After deployment, run `npm run test:contract -w xcp-api` and open the displayed transaction to confirm its event explains the row.

The registry intentionally remains in one file. It is long because it is a catalog, but a contributor can search one place, compare neighboring examples, and review the complete historical surface without following barrel exports or hidden registration side effects.
