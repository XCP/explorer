-- Durable chain evidence for recovery-attempt status and confirmation reporting.
ALTER TABLE recovery_attempts ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 0 CHECK(confirmations >= 0);
ALTER TABLE recovery_attempts ADD COLUMN block_hash TEXT;
ALTER TABLE recovery_attempts ADD COLUMN block_time INTEGER;
ALTER TABLE recovery_attempts ADD COLUMN chain_checked_at INTEGER;
ALTER TABLE recovery_attempts ADD COLUMN status_reason TEXT NOT NULL DEFAULT 'awaiting-chain-evidence';

CREATE INDEX recovery_attempts_reconciliation
  ON recovery_attempts(chain_checked_at, reported_at, txid);
