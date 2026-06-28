-- Phase 2 (cont.): AMM pools + pool matches, and fairminter modeling for soft-cap progress / projected holders.

CREATE TABLE IF NOT EXISTS pools (
  lp_asset            TEXT PRIMARY KEY,
  pair                TEXT,
  asset_a             TEXT,
  asset_b             TEXT,
  reserve_a           TEXT,
  reserve_b           TEXT,
  lp_supply           TEXT,
  price               REAL,
  status              TEXT,
  block_index         INTEGER NOT NULL,
  updated_block_index INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pools_pair  ON pools(pair);
CREATE INDEX IF NOT EXISTS idx_pools_a     ON pools(asset_a);
CREATE INDEX IF NOT EXISTS idx_pools_b     ON pools(asset_b);

CREATE TABLE IF NOT EXISTS pool_matches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash             TEXT NOT NULL,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  source              TEXT,
  lp_asset            TEXT,
  pair                TEXT,
  forward_asset       TEXT,
  forward_quantity    TEXT,
  backward_asset      TEXT,
  backward_quantity   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pm_block ON pool_matches(block_index);
CREATE INDEX IF NOT EXISTS idx_pm_lp    ON pool_matches(lp_asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_pm_pair  ON pool_matches(pair, block_index DESC);

-- fairminter modeling: caps + running raised so we can show progress-to-soft-cap and project holders.
ALTER TABLE fairminters ADD COLUMN soft_cap TEXT;
ALTER TABLE fairminters ADD COLUMN soft_cap_deadline_block INTEGER;
ALTER TABLE fairminters ADD COLUMN max_mint_per_tx TEXT;
ALTER TABLE fairminters ADD COLUMN start_block INTEGER;
ALTER TABLE fairminters ADD COLUMN end_block INTEGER;
ALTER TABLE fairminters ADD COLUMN earned_quantity TEXT;     -- running total minted (from fairmints)
ALTER TABLE fairminters ADD COLUMN paid_quantity TEXT;       -- running total paid in (toward soft cap)
ALTER TABLE fairminters ADD COLUMN divisible INTEGER DEFAULT 0;

-- per-fairmint contribution detail (who paid what / earned what) — powers projected-holders computation.
ALTER TABLE fairmints ADD COLUMN paid_quantity TEXT;
ALTER TABLE fairmints ADD COLUMN commission TEXT;
