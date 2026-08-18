-- Reconstructed from the deployed schema on 2026-08-18, from
-- sqlite_master on xcpio-btc. The index has been live in production since it
-- was applied by hand; the file was never committed on any branch, so every
-- rebuild from this directory produced a database missing it and nothing said
-- so. ops/check-migration-parity.mjs now fails on exactly this.
--
-- It carries the reverify arm's ordering inside the recoverable set: walk
-- chain_checked_at ascending, page by (txid, vout), skip everything else via
-- the partial predicate rather than a filter.
--
-- Note for whoever measures next: 0015's idx_recovery_outputs_backstop covers
-- the same access path with classification leading instead of partial, so this
-- one may now be redundant -- and both are maintained on every write to
-- recovery_outputs. That is a measurement, not a guess, so it stays until
-- someone takes it; dropping an index another query quietly leans on is the
-- more expensive mistake.
CREATE INDEX IF NOT EXISTS recovery_outputs_reverify
  ON recovery_outputs (chain_checked_at, txid, vout)
  WHERE classification = 'recoverable';
