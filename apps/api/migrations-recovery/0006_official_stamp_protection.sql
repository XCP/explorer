-- Additive provenance from the official stampchain-io/btc_stamps indexer.
-- This table records resumable source pages; it never removes issuance-derived
-- protection rows or protected transaction records.
CREATE TABLE recovery_stamp_import_receipts (
  page_cursor INTEGER PRIMARY KEY,
  next_cursor INTEGER,
  rows_seen INTEGER NOT NULL CHECK (rows_seen >= 0),
  snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),
  recorded_at INTEGER NOT NULL,
  CHECK (
    next_cursor IS NULL
    OR next_cursor > page_cursor
  )
);

INSERT INTO
  recovery_state (KEY, value, updated_at)
VALUES
  ('official_stamp_protection_ready', '0', unixepoch())
ON CONFLICT (KEY) DO NOTHING;
