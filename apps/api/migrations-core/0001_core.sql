-- Canonical compact Counterparty mirror. This database is populated and parity-checked before it serves reads.
-- Public strings are decoded at the API boundary; filters and pagination operate on compact base columns.

CREATE TABLE address_dictionary (
  address_id INTEGER PRIMARY KEY,
  address TEXT NOT NULL UNIQUE
);

CREATE TABLE asset_dictionary (
  asset_id INTEGER PRIMARY KEY,
  asset TEXT NOT NULL UNIQUE
);

-- Protocol-native assets exist without an issuance row and must always resolve.
INSERT INTO asset_dictionary(asset) VALUES ('BTC'), ('XCP');

CREATE TABLE core_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO core_state(key, value) VALUES
  ('backfill_active', '1'),
  ('shadow_reads', '0'),
  ('read_cutover', '0');

CREATE TABLE blocks (
  block_index INTEGER PRIMARY KEY,
  block_hash BLOB,
  block_time INTEGER,
  previous_block_hash BLOB,
  difficulty TEXT,
  ledger_hash BLOB,
  txlist_hash BLOB,
  messages_hash BLOB,
  transaction_count INTEGER
);

CREATE TABLE transactions (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  destination_id INTEGER,
  btc_amount TEXT,
  fee TEXT,
  supported INTEGER NOT NULL DEFAULT 1,
  utxos_info TEXT
);
CREATE INDEX idx_transactions_block ON transactions(block_index, tx_index);
CREATE INDEX idx_transactions_source ON transactions(source_id, block_index DESC, tx_index DESC);
CREATE INDEX idx_transactions_destination ON transactions(destination_id, block_index DESC, tx_index DESC);

CREATE TABLE assets (
  asset_id INTEGER PRIMARY KEY,
  asset_longname TEXT,
  numeric_asset_id TEXT,
  type TEXT NOT NULL DEFAULT 'asset',
  issuer_id INTEGER,
  owner_id INTEGER,
  divisible INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  description_locked INTEGER NOT NULL DEFAULT 0,
  supply TEXT,
  supply_normalized TEXT,
  description TEXT,
  mime_type TEXT,
  first_issuance_block_index INTEGER,
  last_issuance_block_index INTEGER,
  first_issuance_block_time INTEGER,
  last_issuance_block_time INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_assets_longname ON assets(asset_longname) WHERE asset_longname IS NOT NULL;
CREATE INDEX idx_assets_issuer ON assets(issuer_id);
CREATE INDEX idx_assets_owner ON assets(owner_id);
CREATE INDEX idx_assets_last_block ON assets(last_issuance_block_index DESC);
CREATE INDEX idx_assets_type_first_block ON assets(type, first_issuance_block_index);

CREATE TABLE sends (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL,
  tx_hash BLOB NOT NULL,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  destination_id INTEGER,
  source_address_id INTEGER,
  destination_address_id INTEGER,
  asset_id INTEGER,
  quantity TEXT,
  quantity_normalized TEXT,
  memo TEXT,
  memo_hex TEXT,
  send_type TEXT,
  status TEXT,
  fee_paid TEXT,
  msg_index INTEGER NOT NULL,
  UNIQUE(tx_index, msg_index),
  UNIQUE(tx_hash, msg_index)
);
CREATE INDEX idx_sends_tx ON sends(tx_index);
CREATE INDEX idx_sends_block ON sends(block_index, event_index);
CREATE INDEX idx_sends_source ON sends(source_id, block_index DESC, event_index DESC);
CREATE INDEX idx_sends_destination ON sends(destination_id, block_index DESC, event_index DESC);
CREATE INDEX idx_sends_asset ON sends(asset_id, block_index DESC, event_index DESC);

-- Address and UTXO holders remain one polymorphic balance relation, matching Counterparty semantics.
CREATE TABLE balances (
  balance_id INTEGER PRIMARY KEY,
  address_id INTEGER,
  utxo_tx_hash BLOB,
  utxo_vout INTEGER,
  asset_id INTEGER NOT NULL,
  quantity TEXT NOT NULL,
  quantity_normalized TEXT,
  updated_block_index INTEGER,
  updated_event_index INTEGER NOT NULL DEFAULT 0,
  utxo_address_id INTEGER,
  holder_type TEXT GENERATED ALWAYS AS (
    CASE WHEN address_id IS NOT NULL THEN 'address' ELSE 'utxo' END
  ) VIRTUAL,
  CHECK (
    (address_id IS NOT NULL AND utxo_tx_hash IS NULL AND utxo_vout IS NULL) OR
    (address_id IS NULL AND utxo_tx_hash IS NOT NULL AND utxo_vout IS NOT NULL)
  )
);
CREATE UNIQUE INDEX idx_balances_address_asset ON balances(address_id, asset_id) WHERE address_id IS NOT NULL;
CREATE UNIQUE INDEX idx_balances_utxo_asset ON balances(utxo_tx_hash, utxo_vout, asset_id) WHERE utxo_tx_hash IS NOT NULL;
CREATE INDEX idx_balances_asset_quantity ON balances(asset_id, CAST(quantity AS INTEGER) DESC)
  WHERE CAST(quantity AS INTEGER) > 0;
CREATE INDEX idx_balances_utxo_address ON balances(utxo_address_id) WHERE utxo_address_id IS NOT NULL;

CREATE TABLE balance_snapshots (
  snapshot_id INTEGER PRIMARY KEY,
  address_id INTEGER,
  utxo_tx_hash BLOB,
  utxo_vout INTEGER,
  asset_id INTEGER NOT NULL,
  block_index INTEGER NOT NULL,
  quantity TEXT NOT NULL,
  updated_event_index INTEGER NOT NULL,
  CHECK (
    (address_id IS NOT NULL AND utxo_tx_hash IS NULL AND utxo_vout IS NULL) OR
    (address_id IS NULL AND utxo_tx_hash IS NOT NULL AND utxo_vout IS NOT NULL)
  )
);
CREATE UNIQUE INDEX idx_balance_snapshots_address
  ON balance_snapshots(address_id, asset_id, block_index) WHERE address_id IS NOT NULL;
CREATE UNIQUE INDEX idx_balance_snapshots_utxo
  ON balance_snapshots(utxo_tx_hash, utxo_vout, asset_id, block_index) WHERE utxo_tx_hash IS NOT NULL;
CREATE INDEX idx_balance_snapshots_block ON balance_snapshots(block_index);

CREATE TABLE orders (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  give_asset_id INTEGER,
  give_quantity TEXT,
  give_remaining TEXT,
  get_asset_id INTEGER,
  get_quantity TEXT,
  get_remaining TEXT,
  expiration INTEGER,
  expire_index INTEGER,
  fee_required TEXT,
  fee_required_remaining TEXT,
  fee_provided TEXT,
  fee_provided_remaining TEXT,
  status TEXT,
  closed_block_index INTEGER
);
CREATE INDEX idx_orders_block ON orders(block_index, tx_index);
CREATE INDEX idx_orders_source ON orders(source_id, block_index DESC);
CREATE INDEX idx_orders_give ON orders(give_asset_id, status);
CREATE INDEX idx_orders_get ON orders(get_asset_id, status);

CREATE TABLE order_matches (
  tx0_index INTEGER NOT NULL,
  tx1_index INTEGER NOT NULL,
  tx0_hash BLOB NOT NULL,
  tx1_hash BLOB NOT NULL,
  tx0_address_id INTEGER,
  tx1_address_id INTEGER,
  forward_asset_id INTEGER,
  forward_quantity TEXT,
  backward_asset_id INTEGER,
  backward_quantity TEXT,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  status TEXT,
  match_expire_index INTEGER,
  fee_paid TEXT,
  tx0_block_index INTEGER,
  tx1_block_index INTEGER,
  tx0_expiration INTEGER,
  tx1_expiration INTEGER,
  PRIMARY KEY(tx0_index, tx1_index)
);
CREATE INDEX idx_order_matches_block ON order_matches(block_index, tx0_index, tx1_index);
CREATE INDEX idx_order_matches_tx0_address ON order_matches(tx0_address_id, block_index DESC);
CREATE INDEX idx_order_matches_tx1_address ON order_matches(tx1_address_id, block_index DESC);
CREATE INDEX idx_order_matches_forward_asset ON order_matches(forward_asset_id, block_index DESC);
CREATE INDEX idx_order_matches_backward_asset ON order_matches(backward_asset_id, block_index DESC);

CREATE TABLE issuances (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL,
  tx_hash BLOB NOT NULL,
  msg_index INTEGER NOT NULL DEFAULT 0,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  asset_id INTEGER,
  asset_longname TEXT,
  quantity TEXT,
  quantity_normalized TEXT,
  source_id INTEGER,
  issuer_id INTEGER,
  transfer INTEGER NOT NULL DEFAULT 0,
  divisible INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  fee_paid TEXT,
  status TEXT,
  asset_events TEXT,
  mime_type TEXT,
  reset INTEGER,
  callable INTEGER,
  call_date INTEGER,
  call_price TEXT,
  UNIQUE(tx_index, msg_index),
  UNIQUE(tx_hash, msg_index)
);
CREATE INDEX idx_issuances_block ON issuances(block_index, event_index);
CREATE INDEX idx_issuances_asset ON issuances(asset_id, block_index DESC, event_index DESC);
CREATE INDEX idx_issuances_source ON issuances(source_id, block_index DESC, event_index DESC);
CREATE INDEX idx_issuances_issuer ON issuances(issuer_id, block_index DESC, event_index DESC);
