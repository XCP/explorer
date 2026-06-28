-- tx_hash on transactions: drop the UNIQUE constraint (defensive — keep tx_index as PK, tx_hash as a
-- plain lookup index). One-to-many tables already use autoincrement id + non-unique tx_hash.
DROP INDEX IF EXISTS idx_tx_hash;
CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash);
