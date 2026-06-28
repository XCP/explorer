-- Phase 2: full Counterparty mirror (chronological event replay). Every row carries block_index so a
-- reorg can cascade-delete WHERE block_index > rollbackTo. Cumulative balances use periodic snapshots.
-- Raw bigint quantities stored as TEXT (JS-safe); *_normalized as TEXT human units. Shapes follow CP /v2.

-- ---- chain ----
CREATE TABLE IF NOT EXISTS blocks (
  block_index       INTEGER PRIMARY KEY,
  block_hash        TEXT,
  block_time        INTEGER,
  ledger_hash       TEXT,
  txlist_hash       TEXT,
  messages_hash     TEXT,
  transaction_count INTEGER
);

CREATE TABLE IF NOT EXISTS transactions (
  tx_index     INTEGER PRIMARY KEY,
  tx_hash      TEXT NOT NULL,
  block_index  INTEGER NOT NULL,
  block_time   INTEGER,
  source       TEXT,
  destination  TEXT,
  btc_amount   TEXT,
  fee          TEXT,
  data         TEXT,
  supported    INTEGER NOT NULL DEFAULT 1,
  utxos_info   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_hash   ON transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_tx_block         ON transactions(block_index);
CREATE INDEX IF NOT EXISTS idx_tx_source        ON transactions(source, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_tx_dest          ON transactions(destination, block_index DESC);

-- ---- balances (current) + periodic snapshots for reorg restore ----
-- holder = address OR "txid:vout" (utxo-attached); holder_type distinguishes.
CREATE TABLE IF NOT EXISTS balances (
  holder                TEXT NOT NULL,
  asset                 TEXT NOT NULL,
  holder_type           TEXT NOT NULL DEFAULT 'address',   -- address | utxo
  quantity              TEXT NOT NULL DEFAULT '0',
  quantity_normalized   TEXT,
  updated_block_index   INTEGER,
  PRIMARY KEY (holder, asset)
);
CREATE INDEX IF NOT EXISTS idx_bal_asset  ON balances(asset, holder_type);
CREATE INDEX IF NOT EXISTS idx_bal_holder ON balances(holder);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  holder       TEXT NOT NULL,
  asset        TEXT NOT NULL,
  block_index  INTEGER NOT NULL,
  quantity     TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (holder, asset, block_index)
);
CREATE INDEX IF NOT EXISTS idx_snap_block ON balance_snapshots(block_index);

-- ---- movements / actions (all block_index-tagged) ----
CREATE TABLE IF NOT EXISTS sends (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash             TEXT NOT NULL,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  source              TEXT,
  destination         TEXT,
  asset               TEXT,
  quantity            TEXT,
  quantity_normalized TEXT,
  memo                TEXT,
  send_type           TEXT,            -- send | enhanced_send | mpma | attach | detach | move
  status              TEXT
);
CREATE INDEX IF NOT EXISTS idx_sends_block  ON sends(block_index);
CREATE INDEX IF NOT EXISTS idx_sends_src    ON sends(source, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_sends_dest   ON sends(destination, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_sends_asset  ON sends(asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_sends_txhash ON sends(tx_hash);

CREATE TABLE IF NOT EXISTS issuances (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash             TEXT NOT NULL,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  asset               TEXT,
  asset_longname      TEXT,
  quantity            TEXT,
  quantity_normalized TEXT,
  source              TEXT,
  issuer              TEXT,
  transfer            INTEGER NOT NULL DEFAULT 0,
  divisible           INTEGER NOT NULL DEFAULT 0,
  locked              INTEGER NOT NULL DEFAULT 0,
  description         TEXT,
  fee_paid            TEXT,
  status              TEXT,
  asset_events        TEXT
);
CREATE INDEX IF NOT EXISTS idx_iss_block ON issuances(block_index);
CREATE INDEX IF NOT EXISTS idx_iss_asset ON issuances(asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_iss_src   ON issuances(source, block_index DESC);

CREATE TABLE IF NOT EXISTS dispensers (
  tx_hash                       TEXT PRIMARY KEY,
  block_index                   INTEGER NOT NULL,
  block_time                    INTEGER,
  source                        TEXT,
  asset                         TEXT,
  give_quantity                 TEXT,
  give_quantity_normalized      TEXT,
  escrow_quantity               TEXT,
  give_remaining                TEXT,
  give_remaining_normalized     TEXT,
  satoshirate                   TEXT,
  satoshirate_normalized        TEXT,
  status                        INTEGER,
  oracle_address                TEXT,
  dispense_count                INTEGER NOT NULL DEFAULT 0,
  closed_block_index            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_disp_block  ON dispensers(block_index);
CREATE INDEX IF NOT EXISTS idx_disp_source ON dispensers(source, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_disp_asset  ON dispensers(asset, status);

CREATE TABLE IF NOT EXISTS dispenses (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash                     TEXT NOT NULL,
  dispense_index              INTEGER,
  dispenser_tx_hash           TEXT,
  source                      TEXT,
  destination                 TEXT,
  asset                       TEXT,
  dispense_quantity           TEXT,
  dispense_quantity_normalized TEXT,
  btc_amount                  TEXT,
  block_index                 INTEGER NOT NULL,
  block_time                  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dispe_block ON dispenses(block_index);
CREATE INDEX IF NOT EXISTS idx_dispe_disp  ON dispenses(dispenser_tx_hash);
CREATE INDEX IF NOT EXISTS idx_dispe_asset ON dispenses(asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_dispe_dest  ON dispenses(destination, block_index DESC);

CREATE TABLE IF NOT EXISTS orders (
  tx_hash                     TEXT PRIMARY KEY,
  block_index                 INTEGER NOT NULL,
  block_time                  INTEGER,
  source                      TEXT,
  give_asset                  TEXT,
  give_quantity               TEXT,
  give_remaining              TEXT,
  get_asset                   TEXT,
  get_quantity                TEXT,
  get_remaining               TEXT,
  expiration                  INTEGER,
  expire_index                INTEGER,
  fee_required                TEXT,
  fee_provided                TEXT,
  status                      TEXT,
  closed_block_index          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ord_block  ON orders(block_index);
CREATE INDEX IF NOT EXISTS idx_ord_source ON orders(source, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_ord_give   ON orders(give_asset, status);
CREATE INDEX IF NOT EXISTS idx_ord_get    ON orders(get_asset, status);

CREATE TABLE IF NOT EXISTS order_matches (
  id                            TEXT PRIMARY KEY,   -- "tx0_tx1"
  tx0_hash                      TEXT,
  tx1_hash                      TEXT,
  tx0_address                   TEXT,
  tx1_address                   TEXT,
  forward_asset                 TEXT,
  forward_quantity              TEXT,
  backward_asset                TEXT,
  backward_quantity             TEXT,
  block_index                   INTEGER NOT NULL,
  block_time                    INTEGER,
  status                        TEXT
);
CREATE INDEX IF NOT EXISTS idx_om_block ON order_matches(block_index);
CREATE INDEX IF NOT EXISTS idx_om_addr  ON order_matches(tx0_address, block_index DESC);

CREATE TABLE IF NOT EXISTS sweeps (
  tx_hash      TEXT PRIMARY KEY,
  block_index  INTEGER NOT NULL,
  block_time   INTEGER,
  source       TEXT,
  destination  TEXT,
  flags        INTEGER,
  memo         TEXT,
  fee_paid     TEXT,
  status       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sweeps_block ON sweeps(block_index);
CREATE INDEX IF NOT EXISTS idx_sweeps_src   ON sweeps(source, block_index DESC);

CREATE TABLE IF NOT EXISTS fairminters (
  tx_hash      TEXT PRIMARY KEY,
  block_index  INTEGER NOT NULL,
  block_time   INTEGER,
  source       TEXT,
  asset        TEXT,
  asset_longname TEXT,
  price        TEXT,
  hard_cap     TEXT,
  status       TEXT
);
CREATE INDEX IF NOT EXISTS idx_fm_block ON fairminters(block_index);
CREATE INDEX IF NOT EXISTS idx_fm_asset ON fairminters(asset);

CREATE TABLE IF NOT EXISTS fairmints (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash             TEXT NOT NULL,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  source              TEXT,
  fairminter_tx_hash  TEXT,
  asset               TEXT,
  earn_quantity       TEXT,
  status              TEXT
);
CREATE INDEX IF NOT EXISTS idx_fmint_block ON fairmints(block_index);
CREATE INDEX IF NOT EXISTS idx_fmint_asset ON fairmints(asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_fmint_src   ON fairmints(source, block_index DESC);
