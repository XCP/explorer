-- Exact O(1) progress for the finite Bitcoin-fee backfill. Transaction indexes
-- are the canonical contiguous identity; triggers maintain the missing counter
-- through forward sync, fee reconciliation, and reorg deletion/replay.
INSERT INTO core_state(key,value)
SELECT 'bitcoin_fees_remaining',CAST(COUNT(*) AS TEXT)
FROM transactions WHERE fee IS NULL
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

CREATE TRIGGER bitcoin_fees_progress_insert AFTER INSERT ON transactions
WHEN NEW.fee IS NULL BEGIN
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)
  WHERE key='bitcoin_fees_remaining';
END;

CREATE TRIGGER bitcoin_fees_progress_delete AFTER DELETE ON transactions
WHEN OLD.fee IS NULL BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-1) AS TEXT)
  WHERE key='bitcoin_fees_remaining';
END;

CREATE TRIGGER bitcoin_fees_progress_update AFTER UPDATE OF fee ON transactions
WHEN OLD.fee IS NOT NEW.fee AND (OLD.fee IS NULL OR NEW.fee IS NULL) BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)
    + CASE WHEN NEW.fee IS NULL THEN 1 ELSE -1 END) AS TEXT)
  WHERE key='bitcoin_fees_remaining';
END;
