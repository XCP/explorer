CREATE TABLE address_dictionary (
  address_id INTEGER PRIMARY KEY,
  address TEXT NOT NULL UNIQUE
);

CREATE TABLE asset_dictionary (
  asset_id INTEGER PRIMARY KEY,
  asset TEXT NOT NULL UNIQUE
);

CREATE TABLE ledger_events (
  event_index INTEGER PRIMARY KEY,
  direction INTEGER NOT NULL CHECK (direction IN (0, 1)),
  block_index INTEGER NOT NULL,
  tx_hash BLOB,
  address_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  quantity TEXT NOT NULL,
  calling_function TEXT,
  utxo_address_id INTEGER
);

CREATE INDEX idx_ledger_address_page
  ON ledger_events(address_id, block_index DESC, event_index DESC);
CREATE INDEX idx_ledger_asset_address
  ON ledger_events(asset_id, address_id);
CREATE INDEX idx_ledger_block ON ledger_events(block_index);

CREATE TABLE ledger_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO ledger_state(key, value) VALUES ('backfill_active', '1');
