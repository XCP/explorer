# Reorg recovery

Counterparty Core caches some block URLs across rollbacks. Every indexer read now
uses a fresh URL, including fixed event cursors, continuation pages and retries.
Core uses the first scalar `verbose` value; a second UUID value changes the URL
cache key without changing pagination or enrichment. The configured provider is
still trusted: this is not an independent Bitcoin consensus check.

Replay verifies the last locally written block during catch-up as well as following.
An unavailable hash stops the pass. Each NEW_BLOCK must match a fresh header and
extend the locally applied hash; the parent is checked again after fetching a page.
A fork cannot be hidden by advancing to a child on a different branch.

Migration `0100_reorg_undo.sql` retains exact before-images of mutable assets,
orders/matches, dispensers, fairminters, pools, bets/matches and RPS/matches. The
journal context and each batch of event writes share a D1 transaction. Rollback
applies inverses in reverse order, atomically removing each consumed journal row,
so interruption is resumable. Existing balance-delta rollback remains in place.
Remaining quantities and dispenser status are restored, not guessed from closure.

Apply migration 0100 before deploying. The undo floor starts at the deployment
checkpoint and retains 24 blocks. Older forks stop for a verified rebuild; the
migration cannot invent before-images for previously indexed data. Pause replay
for administrative imports/rebuilds, then establish a new verified undo baseline.
Keep trigger column lists current when changing a journaled table's schema.

Tests exercise a retained URL cache, stale parent probes, catch-up verification,
unknown hashes, exact partial-fill rollback, interrupted undo and missing history.
This change does not certify historical imported state or all asynchronous derived
projections; those retain their existing repair queues and maintenance behavior.

Replay also compares stored `ledger_hash` and `messages_hash`, so Counterparty
reparses are detected even when the Bitcoin block hash stays unchanged. The last
completed block is verified when the cursor is inside a partially applied block.
Before writes, each replay slice saves its verified block identities in
`core_state.replay_protocol_identities`. They survive cursor commits and restarts,
covering partial blocks whose `BLOCK_PARSED` event has not yet been applied.

A fixed parsed source-tip identity is captured before event retrieval and checked
again before writes. A newly mined descendant does not change that fixed anchor.
Missing protocol hashes pause replay; a changed anchor during fetching retries
without resetting application data. Confirmed mismatches use the existing exact
undo path and require a protocol-verified ancestor within retained history.

No additional migration is needed. Blocks already store completed protocol
identities; the new state key records future slices without inventing hashes for
historical incomplete blocks. Administrative imports must establish a verified
baseline and clear obsolete slice identities while replay is paused. Each slice
adds bounded header reads and one small durable state write. Following mode
normally needs one slice; backlog processing costs more verification requests.
