PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS index_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS watched_address (
  address_id INTEGER PRIMARY KEY,
  address TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS counterparty_tx_watch (
  tx_hash BLOB PRIMARY KEY,
  tx_index INTEGER,
  expected_block_height INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS counterparty_tx_watch_block
ON counterparty_tx_watch(expected_block_height, tx_hash);

-- Counterparty's UTXO-address model identifies an asset-bearing Bitcoin output
-- as txid:vout. It is an entity, not a Bitcoin payment address.
CREATE TABLE IF NOT EXISTS counterparty_utxo_watch (
  entity_id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL UNIQUE,
  tx_hash BLOB NOT NULL,
  vout INTEGER NOT NULL CHECK(vout>=0),
  owner_address_id INTEGER,
  owner TEXT NOT NULL,
  UNIQUE(tx_hash,vout)
);

CREATE TABLE IF NOT EXISTS scan_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  block_height INTEGER NOT NULL,
  block_hash BLOB NOT NULL,
  policy_version TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);

-- One canonical row per scanned Bitcoin block. Counterparty byte share is the
-- sum of serialized Counterparty transaction sizes divided by Bitcoin's full
-- serialized block size; weight share is the preferable capacity measure.
CREATE TABLE IF NOT EXISTS btc_block_metrics (
  block_height INTEGER PRIMARY KEY,
  block_hash BLOB NOT NULL UNIQUE,
  block_time INTEGER NOT NULL,
  block_size_bytes INTEGER NOT NULL,
  block_weight INTEGER NOT NULL,
  transaction_count INTEGER NOT NULL,
  subsidy_sats INTEGER NOT NULL,
  total_fee_sats INTEGER NOT NULL,
  coinbase_output_sats INTEGER NOT NULL,
  counterparty_transaction_count INTEGER NOT NULL,
  counterparty_size_bytes INTEGER NOT NULL,
  counterparty_weight INTEGER NOT NULL,
  counterparty_fee_sats INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS btc_block_metrics_time ON btc_block_metrics(block_time, block_height);

CREATE TABLE IF NOT EXISTS btc_tx (
  tx_id INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_height INTEGER NOT NULL,
  tx_position INTEGER NOT NULL,
  block_time INTEGER NOT NULL,
  fee_sats INTEGER,
  flags INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS btc_counterparty_utxo (
  entity_id INTEGER PRIMARY KEY REFERENCES counterparty_utxo_watch(entity_id),
  created_tx_id INTEGER REFERENCES btc_tx(tx_id),
  value_sats INTEGER CHECK(value_sats>=0),
  script_type TEXT,
  script_hash BLOB,
  resolved_owner TEXT,
  spent_by_tx_id INTEGER REFERENCES btc_tx(tx_id),
  spend_input_index INTEGER,
  spent_height INTEGER
);
CREATE INDEX IF NOT EXISTS btc_counterparty_utxo_spender
ON btc_counterparty_utxo(spent_by_tx_id);
CREATE INDEX IF NOT EXISTS btc_tx_block ON btc_tx(block_height, tx_position);

CREATE TABLE IF NOT EXISTS btc_address_io (
  address_id INTEGER NOT NULL,
  tx_id INTEGER NOT NULL,
  direction INTEGER NOT NULL CHECK (direction IN (0, 1)),
  io_index INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  PRIMARY KEY (address_id, tx_id, direction, io_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS btc_address_io_tx ON btc_address_io(tx_id, direction, io_index);

CREATE TABLE IF NOT EXISTS btc_external_address (
  external_address_id INTEGER PRIMARY KEY,
  address TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS btc_external_io (
  external_address_id INTEGER NOT NULL,
  tx_id INTEGER NOT NULL,
  direction INTEGER NOT NULL CHECK (direction IN (0, 1)),
  io_index INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  PRIMARY KEY (external_address_id, tx_id, direction, io_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS btc_external_io_tx
ON btc_external_io(tx_id, direction, io_index);

-- Compact evidence retained for every external address seen beside a watched
-- Counterparty address. Multiple I/O rows for one address in one transaction
-- increment transaction_count once. Singleton rows may be pruned after the
-- historical pass; keeping them during the pass permits later promotion.
CREATE TABLE IF NOT EXISTS btc_external_summary (
  address TEXT PRIMARY KEY,
  transaction_count INTEGER NOT NULL CHECK(transaction_count>0),
  input_rows INTEGER NOT NULL CHECK(input_rows>=0),
  output_rows INTEGER NOT NULL CHECK(output_rows>=0),
  input_sats INTEGER NOT NULL CHECK(input_sats>=0),
  output_sats INTEGER NOT NULL CHECK(output_sats>=0),
  first_tx_id INTEGER NOT NULL REFERENCES btc_tx(tx_id),
  last_tx_id INTEGER NOT NULL REFERENCES btc_tx(tx_id)
) WITHOUT ROWID;

-- Raw external event detail is opt-in. Market/OTC/reputation jobs place a
-- transaction hash here before scanning or explicitly backfill it later.
CREATE TABLE IF NOT EXISTS btc_external_event_watch (
  tx_hash BLOB PRIMARY KEY,
  reason TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS btc_unknown_script_io (
  tx_id INTEGER NOT NULL,
  direction INTEGER NOT NULL CHECK (direction IN (0, 1)),
  io_index INTEGER NOT NULL,
  script_type TEXT NOT NULL,
  script_hash BLOB NOT NULL,
  value_sats INTEGER NOT NULL,
  PRIMARY KEY (tx_id, direction, io_index)
) WITHOUT ROWID;

-- Specialized extension of ordinary Bitcoin outputs. Observed spend evidence
-- is retained even when Counterparty provenance/ownership remains unverified.
CREATE TABLE IF NOT EXISTS btc_recovery_output (
  tx_hash BLOB NOT NULL,
  vout INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  script_pubkey_hex TEXT NOT NULL,
  layout TEXT NOT NULL CHECK (layout IN ('historical-1-of-2', 'current-1-of-3')),
  recovery_key_hex TEXT,
  recovery_key_position INTEGER,
  recovery_address TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('recoverable', 'spent', 'ambiguous', 'unsupported', 'invalid', 'unverified')),
  reason TEXT NOT NULL,
  block_height INTEGER NOT NULL,
  block_time INTEGER NOT NULL,
  spent_by_tx_hash BLOB,
  spent_height INTEGER,
  classifier_version INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, vout)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS btc_recovery_output_address
ON btc_recovery_output(recovery_address, classification, value_sats DESC, tx_hash, vout)
WHERE recovery_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS btc_recovery_output_spent
ON btc_recovery_output(spent_height, tx_hash, vout);

CREATE TABLE IF NOT EXISTS btc_direct_flow (
  tx_id INTEGER NOT NULL,
  payer_id INTEGER NOT NULL,
  payee_id INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  payer_input_count INTEGER NOT NULL,
  payee_output_count INTEGER NOT NULL,
  attribution_flags INTEGER NOT NULL,
  PRIMARY KEY (tx_id, payer_id, payee_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS btc_direct_flow_payee ON btc_direct_flow(payee_id, tx_id);
CREATE INDEX IF NOT EXISTS btc_direct_flow_payer ON btc_direct_flow(payer_id, tx_id);

CREATE TABLE IF NOT EXISTS watched_utxo (
  tx_hash BLOB NOT NULL,
  vout INTEGER NOT NULL,
  address_id INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, vout, address_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS watched_utxo_address ON watched_utxo(address_id);

CREATE TABLE IF NOT EXISTS btc_address_stats (
  address_id INTEGER PRIMARY KEY,
  first_block INTEGER,
  last_block INTEGER,
  input_txs INTEGER NOT NULL DEFAULT 0,
  output_txs INTEGER NOT NULL DEFAULT 0,
  sats_in INTEGER NOT NULL DEFAULT 0,
  sats_out INTEGER NOT NULL DEFAULT 0
);

-- Ordinary single-watched-address Bitcoin activity is retained as an exact
-- calendar aggregate rather than millions of event rows. Event detail remains
-- for Counterparty, multi-watched-address, UTXO/recovery, and selected evidence
-- transactions.
CREATE TABLE IF NOT EXISTS btc_address_monthly_stats (
  address_id INTEGER NOT NULL,
  month_start INTEGER NOT NULL,
  input_txs INTEGER NOT NULL DEFAULT 0,
  output_txs INTEGER NOT NULL DEFAULT 0,
  sats_in INTEGER NOT NULL DEFAULT 0,
  sats_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(address_id,month_start)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS btc_address_monthly_time
ON btc_address_monthly_stats(month_start,address_id);

CREATE TABLE IF NOT EXISTS scan_failure (
  block_height INTEGER NOT NULL,
  tx_hash BLOB NOT NULL DEFAULT X'',
  stage TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY (block_height, tx_hash, stage)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS counterparty_tx_fee (
  tx_hash BLOB PRIMARY KEY,
  block_height INTEGER NOT NULL,
  fee_sats INTEGER NOT NULL,
  published_at INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS counterparty_tx_fee_block
ON counterparty_tx_fee(block_height, tx_hash);

CREATE TABLE IF NOT EXISTS fee_coverage (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  expected_transactions INTEGER NOT NULL,
  resolved_transactions INTEGER NOT NULL,
  missing_transactions INTEGER NOT NULL,
  source_height INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_benchmark (
  started_at INTEGER NOT NULL,
  start_height INTEGER NOT NULL,
  end_height INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  blocks INTEGER NOT NULL,
  transactions INTEGER NOT NULL,
  relevant_transactions INTEGER NOT NULL,
  address_io_rows INTEGER NOT NULL,
  fee_matches INTEGER NOT NULL,
  external_address_rows INTEGER NOT NULL DEFAULT 0,
  external_io_rows INTEGER NOT NULL DEFAULT 0,
  unknown_script_io_rows INTEGER NOT NULL DEFAULT 0,
  recovery_output_rows INTEGER NOT NULL DEFAULT 0,
  recovery_spend_rows INTEGER NOT NULL DEFAULT 0,
  database_bytes INTEGER NOT NULL,
  PRIMARY KEY (started_at, start_height)
) WITHOUT ROWID;
