-- Durable Bitcoin sidecar projections promoted from the verified local bootstrap.
-- This is intentionally bounded: raw Bitcoin blocks/transactions remain a local rebuild artifact;
-- production stores only the projections needed by stats, balances, fees, and coverage.
CREATE TABLE IF NOT EXISTS btc_sidecar_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS btc_block_metrics (
  block_height INTEGER PRIMARY KEY,
  block_hash TEXT NOT NULL CHECK(length(block_hash)=64),
  block_time INTEGER NOT NULL,
  block_size INTEGER NOT NULL CHECK(block_size>=0),
  transaction_count INTEGER NOT NULL CHECK(transaction_count>=0),
  total_fees_sats INTEGER NOT NULL CHECK(total_fees_sats>=0),
  counterparty_transaction_count INTEGER NOT NULL CHECK(counterparty_transaction_count>=0),
  counterparty_fee_sats INTEGER NOT NULL CHECK(counterparty_fee_sats>=0),
  source TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  imported_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS btc_sidecar_address_balance (
  address TEXT PRIMARY KEY,
  balance_sats INTEGER NOT NULL CHECK(balance_sats>=0),
  utxo_count INTEGER NOT NULL CHECK(utxo_count>=0),
  first_block INTEGER,
  last_block INTEGER,
  source TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  imported_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS btc_sidecar_fee (
  tx_hash TEXT PRIMARY KEY CHECK(length(tx_hash)=64),
  block_height INTEGER NOT NULL,
  fee_sats INTEGER NOT NULL CHECK(fee_sats>=0),
  source TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  imported_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS btc_block_metrics_time ON btc_block_metrics(block_time);
CREATE INDEX IF NOT EXISTS btc_block_metrics_counterparty ON btc_block_metrics(counterparty_transaction_count);
CREATE INDEX IF NOT EXISTS btc_sidecar_address_balance_amount ON btc_sidecar_address_balance(balance_sats DESC,address);

INSERT INTO btc_sidecar_state(key,value,updated_at) VALUES
  ('schema_version','1',unixepoch()),
  ('coverage_height','0',unixepoch()),
  ('coverage_hash','',unixepoch()),
  ('source_version','1',unixepoch())
ON CONFLICT(key) DO NOTHING;
