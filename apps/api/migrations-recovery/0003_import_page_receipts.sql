-- Record each source page once so retries cannot inflate import progress.
CREATE TABLE recovery_import_receipts (
  import_id TEXT NOT NULL,
  page_cursor INTEGER NOT NULL CHECK(page_cursor >= 0),
  next_cursor INTEGER CHECK(next_cursor IS NULL OR next_cursor >= page_cursor),
  rows_seen INTEGER NOT NULL CHECK(rows_seen >= 0),
  rows_written INTEGER NOT NULL CHECK(rows_written >= 0),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (import_id, page_cursor),
  FOREIGN KEY (import_id) REFERENCES recovery_imports(id)
) WITHOUT ROWID;

CREATE INDEX recovery_import_receipts_next
  ON recovery_import_receipts(import_id, next_cursor);

-- Preserve progress accumulated before page receipts were introduced. New
-- totals are this immutable baseline plus unique receipts.
ALTER TABLE recovery_imports ADD COLUMN receipt_base_cursor INTEGER;
ALTER TABLE recovery_imports ADD COLUMN receipt_base_rows_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recovery_imports ADD COLUMN receipt_base_rows_written INTEGER NOT NULL DEFAULT 0;

UPDATE recovery_imports
SET receipt_base_cursor = CAST(COALESCE(cursor, '0') AS INTEGER),
    receipt_base_rows_seen = rows_seen,
    receipt_base_rows_written = rows_written;
