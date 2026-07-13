-- Transaction-level safety overlay. Ownership classification remains independent:
-- a protected transaction may contain a structurally recoverable output, but public
-- reads exclude it unless the caller explicitly opts in.
CREATE TABLE recovery_protected_transactions (
  txid TEXT PRIMARY KEY CHECK (length(txid) = 64),
  protection_kind TEXT NOT NULL CHECK (protection_kind IN ('stamp')),
  protected_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE recovery_protection_sources (
  txid TEXT NOT NULL,
  source TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (txid, source, source_reference),
  FOREIGN KEY (txid) REFERENCES recovery_protected_transactions (txid) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX recovery_protection_sources_source ON recovery_protection_sources (source, source_reference, txid);

INSERT INTO
  recovery_state (KEY, value, updated_at)
VALUES
  ('stamp_protection_ready', '0', unixepoch())
ON CONFLICT (KEY) DO NOTHING;
