# Balance integrity repair

## Status

Implementation and bounded audit in progress. Do not equate a caught-up cursor with verified balances.
No full balance reindex or recurring repair sweep is part of this change.

## What failed

Marketplace imported a missing XCP baseline from Explorer. Core history and current state agree;
Explorer's balance projection did not. The Marketplace baseline repair is deployed separately.

Explorer had reproducible failure paths:

- A partial replay updated checkpoint height before checkpoint hash. The next run could mistake
  that mismatched pair for a reorg.
- Rollback treated a missing retained snapshot as a zero opening balance and deleted the row.
- One replay slice could collapse several blocks into one snapshot.
- A D1 batch boundary could separate a balance high-water update from its snapshot.
- Malformed quantities could be rounded or converted to zero, and underflows were not rejected.
- Missing events were not explicitly rejected before advancing the cursor.

Tests reproduce these conditions. Historical state is consistent with baseline loss, but we do not
have execution logs proving the exact original crash or false-reorg invocation.

## Fix

Checkpoint hashes come from locally applied block headers. Each cursor update saves its matching hash.
Already-written headers ahead of an interrupted cursor are checked too. Reorgs require a verified
common ancestor, bounded to 24 blocks. An unfinished rollback has a durable restart marker.

Rollback reverses only orphan credit/debit events covered by each balance's committed high-water.
It does not assume missing history or snapshots mean zero. All restore calculations happen before
branch deletion; orphan ledger evidence stays until every restore completes. Retrying a partial
rollback does not reverse a balance twice. Missing provenance fails closed.

Normal replay uses exact raw integers, rejects underflow, requires contiguous events, retains
per-block checkpoints, and commits each balance with its snapshots in one atomic batch.
Unchanged replay retries write no balances or snapshots.

## Audit scope

First pass: all 1,793 address/asset pairs across the four known negative-balance addresses, not just
negative rows. Complete Core credit/debit pagination, current balances, local ledger totals grouped
by block/asset/direction, and retained snapshots were compared at stable checkpoints.

That pass found 38 bad balances and 39 bad snapshots. Expanding to every holder touched in blocks
964341 and 965364 found wrong positive balances too, including MYSTERYPEPE at 142 instead of 143.
The successful first pass cost 50,403 D1 row reads and zero writes. Failed/restarted probes add reads;
the number is not the total cost of this investigation.

Receipts live locally under `apps/api/outputs/balance-integrity/`. Each records the checkpoint,
Core evidence, all inspected rows, mismatches, and measured reads. Large evidence files are not committed.

This is not yet a certification of all historical balances. The next broad audit should compare
current state in resumable, budgeted partitions, with an explicit coverage manifest. Source pagination
must be checkpoint-aligned; a missing local row is also a candidate. Do not use random samples or
negative-only queries as completeness claims.

## Commands

From `apps/api`, compile first:

```sh
npx tsc -p tsconfig.test.json
node ops/audit-balance-integrity.mjs ADDRESS [ADDRESS ...]
node ops/repair-audited-balances.mjs outputs/balance-integrity/ADDRESS.json
node ops/repair-audited-balances.mjs outputs/balance-integrity/ADDRESS.json --apply
```

Audit is read-only, paced, limited to ten explicit addresses per invocation, capped at 50,000 history
rows per address and a one-million-read stop budget. It aborts on rate limits, unstable checkpoints,
incomplete pagination, or disagreement between Core history and current state. Core omits counts on
cursor pages; the first page's total is checked against the final accumulated count. Zero-value ledger
events are excluded from history-total comparison because Core's history routes omit them.

Repairs are explicit, not automatic. They recheck Core values and the audited chain, acquire the
existing replay lock, and assert exact stored identities, quantities, high-waters, and no newer ledger
events. Balances and their snapshots change atomically; event cursors and raw history do not change.
Wrangler SQL-file imports briefly block database queries and restore the original state on failure.
The SQL and apply output stay beside the audit receipt for review. Changed balances must subsequently
refresh only their affected derived holder/address projections.

## Verification and remaining work

- Regression cases include positive, zero, attached-UTXO, missing-baseline, partial-page, missing-event,
  snapshot failure, rollback restart, raw-write-before-cursor fork, and stale-repair cases.
- Query-plan assertions check block-range and holder/asset index seeks.
- Full API tests, root checks, green PR checks, deployment, and production remeasurement are release gates.
- Marketplace uses an exact undo journal, not Explorer's snapshot fallback. Its imported baseline accuracy
  must still be checked against the verified Explorer differences.
- Exchange has a separate LP history rebuild, but its checkpoint hash also trails its height update.
  Coordinate a separate fix with the active Exchange task; do not overwrite its unrelated work.
- Launchpad and extension were not found to contain this Explorer snapshot rollback implementation.

References: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[D1 SQL imports](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
