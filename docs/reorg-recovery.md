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
