-- api.xcp.io Phase 1 schema: assets mirror + indexer state + read-through cache.
-- Mirrors Counterparty /v2/assets (verbose). Raw bigint quantities stored as TEXT (JS-safe).

CREATE TABLE IF NOT EXISTS assets (
  asset                       TEXT PRIMARY KEY,
  asset_longname              TEXT,
  asset_id                    TEXT,
  type                        TEXT NOT NULL DEFAULT 'asset',   -- native | numeric | subasset | asset
  issuer                      TEXT,
  owner                       TEXT,
  divisible                   INTEGER NOT NULL DEFAULT 0,
  locked                      INTEGER NOT NULL DEFAULT 0,
  description_locked          INTEGER NOT NULL DEFAULT 0,
  supply                      TEXT,                            -- raw quantity (bigint as text)
  supply_normalized           TEXT,                            -- human units as text
  description                 TEXT,
  mime_type                   TEXT,
  first_issuance_block_index  INTEGER,
  last_issuance_block_index   INTEGER,
  first_issuance_block_time   INTEGER,
  last_issuance_block_time    INTEGER,
  updated_at                  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assets_longname   ON assets(asset_longname);
CREATE INDEX IF NOT EXISTS idx_assets_issuer     ON assets(issuer);
CREATE INDEX IF NOT EXISTS idx_assets_owner      ON assets(owner);
CREATE INDEX IF NOT EXISTS idx_assets_last_block ON assets(last_issuance_block_index DESC);

-- key/value cursors + checkpoints for the indexer
CREATE TABLE IF NOT EXISTS indexer_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- read-through cache for unbounded per-address data (utxos etc.) so bots don't slam upstream
CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  ctype      TEXT NOT NULL DEFAULT 'application/json',
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
