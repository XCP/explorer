-- Phase 2 (cont.): the remaining CP models — destructions, burns, dividends, broadcasts.
-- (Balance effects already flow via CREDIT/DEBIT; these tables record the action history for the explorer.)

CREATE TABLE IF NOT EXISTS destructions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash             TEXT NOT NULL,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  source              TEXT,
  asset               TEXT,
  quantity            TEXT,
  quantity_normalized TEXT,
  tag                 TEXT,
  status              TEXT
);
CREATE INDEX IF NOT EXISTS idx_destr_block ON destructions(block_index);
CREATE INDEX IF NOT EXISTS idx_destr_asset ON destructions(asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_destr_src   ON destructions(source, block_index DESC);

CREATE TABLE IF NOT EXISTS burns (
  tx_hash             TEXT PRIMARY KEY,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  source              TEXT,
  burned              TEXT,
  burned_normalized   TEXT,
  earned              TEXT,
  earned_normalized   TEXT,
  status              TEXT
);
CREATE INDEX IF NOT EXISTS idx_burns_block ON burns(block_index);
CREATE INDEX IF NOT EXISTS idx_burns_src   ON burns(source, block_index DESC);

CREATE TABLE IF NOT EXISTS dividends (
  tx_hash                       TEXT PRIMARY KEY,
  block_index                   INTEGER NOT NULL,
  block_time                    INTEGER,
  source                        TEXT,
  asset                         TEXT,
  dividend_asset                TEXT,
  quantity_per_unit             TEXT,
  quantity_per_unit_normalized  TEXT,
  fee_paid                      TEXT,
  status                        TEXT
);
CREATE INDEX IF NOT EXISTS idx_div_block ON dividends(block_index);
CREATE INDEX IF NOT EXISTS idx_div_asset ON dividends(asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_div_src   ON dividends(source, block_index DESC);

CREATE TABLE IF NOT EXISTS broadcasts (
  tx_hash           TEXT PRIMARY KEY,
  block_index       INTEGER NOT NULL,
  block_time        INTEGER,
  source            TEXT,
  timestamp         INTEGER,
  value             TEXT,
  fee_fraction_int  TEXT,
  text              TEXT,
  locked            INTEGER NOT NULL DEFAULT 0,
  mime_type         TEXT,
  status            TEXT
);
CREATE INDEX IF NOT EXISTS idx_bcast_block ON broadcasts(block_index);
CREATE INDEX IF NOT EXISTS idx_bcast_src   ON broadcasts(source, block_index DESC);
