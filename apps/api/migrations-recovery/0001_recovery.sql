-- Compact, rebuildable index of Counterparty bare-multisig recovery outputs.
-- Raw transaction bodies are deduplicated in R2 under transactions/{txid}.hex.
CREATE TABLE recovery_outputs (
  txid TEXT NOT NULL CHECK(length(txid) = 64),
  vout INTEGER NOT NULL CHECK(vout >= 0),
  value_sats INTEGER NOT NULL CHECK(value_sats >= 0),
  script_pubkey_hex TEXT NOT NULL,
  layout TEXT NOT NULL CHECK(layout IN ('historical-1-of-2', 'current-1-of-3')),
  recovery_key_hex TEXT,
  recovery_key_position INTEGER,
  recovery_address TEXT,
  classification TEXT NOT NULL CHECK(classification IN ('recoverable', 'spent', 'ambiguous', 'unsupported', 'invalid', 'unverified')),
  reason TEXT NOT NULL,
  block_height INTEGER,
  block_time INTEGER,
  spent_by_txid TEXT CHECK(spent_by_txid IS NULL OR length(spent_by_txid) = 64),
  spent_height INTEGER,
  verified_at INTEGER NOT NULL,
  classifier_version INTEGER NOT NULL,
  PRIMARY KEY (txid, vout)
) WITHOUT ROWID;

CREATE INDEX recovery_outputs_address
  ON recovery_outputs(recovery_address, classification, value_sats DESC, txid, vout)
  WHERE recovery_address IS NOT NULL;
CREATE INDEX recovery_outputs_verification
  ON recovery_outputs(classification, verified_at, txid, vout);
CREATE INDEX recovery_outputs_block
  ON recovery_outputs(block_height, txid, vout);

CREATE TABLE recovery_attempts (
  txid TEXT PRIMARY KEY CHECK(length(txid) = 64),
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'replaced', 'failed')),
  replacement_txid TEXT CHECK(replacement_txid IS NULL OR length(replacement_txid) = 64),
  network_fee_sats INTEGER NOT NULL CHECK(network_fee_sats >= 0),
  service_fee_sats INTEGER NOT NULL CHECK(service_fee_sats >= 0),
  output_value_sats INTEGER NOT NULL CHECK(output_value_sats >= 0),
  block_height INTEGER,
  reported_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE recovery_attempt_inputs (
  recovery_txid TEXT NOT NULL,
  input_txid TEXT NOT NULL,
  input_vout INTEGER NOT NULL CHECK(input_vout >= 0),
  PRIMARY KEY (recovery_txid, input_txid, input_vout),
  FOREIGN KEY (recovery_txid) REFERENCES recovery_attempts(txid) ON DELETE CASCADE,
  FOREIGN KEY (input_txid, input_vout) REFERENCES recovery_outputs(txid, vout)
) WITHOUT ROWID;
CREATE INDEX recovery_attempt_inputs_output ON recovery_attempt_inputs(input_txid, input_vout);
CREATE INDEX recovery_attempts_address ON recovery_attempts(address, reported_at DESC);

CREATE TABLE recovery_imports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  cursor TEXT,
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
) WITHOUT ROWID;

CREATE TABLE recovery_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
