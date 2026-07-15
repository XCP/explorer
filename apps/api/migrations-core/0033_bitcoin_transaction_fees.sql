-- Staging column for Bitcoin-authoritative miner fees. Once the historical fill is verified,
-- a final migration replaces the legacy Counterparty-derived fee column and removes this column.
ALTER TABLE transactions ADD COLUMN bitcoin_fee TEXT;

CREATE INDEX idx_transactions_missing_bitcoin_fee
  ON transactions(tx_index DESC)
  WHERE bitcoin_fee IS NULL;
