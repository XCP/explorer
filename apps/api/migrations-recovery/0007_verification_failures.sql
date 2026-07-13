-- Isolate transient Electrs failures so one transaction cannot block a batch.
CREATE TABLE recovery_verification_failures (
  txid TEXT PRIMARY KEY CHECK (length(txid) = 64),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  first_failed_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  last_error TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX recovery_verification_failures_retry ON recovery_verification_failures (next_retry_at, txid);
