-- Two repairs in the pool subsystem.
--
-- First: 0086 rebuilt pool_matches and recreated its indexes from an incomplete listing, silently
-- dropping idx_pool_matches_backward_asset — which listAssetPoolMatches leans on for the
-- backward-leg half of its lookup. Restore it.
CREATE INDEX idx_pool_matches_backward_asset ON pool_matches (backward_asset_id, block_index DESC);

-- Second: pool_liquidity carries the identical freeze bug 0086 fixed in pool_matches — UNIQUE
-- tx_index/tx_hash with a handler that only targets ON CONFLICT(event_index). The moment one tx
-- emits two liquidity events, the second insert throws, the atomic replay batch rolls back, and
-- the mirror freezes on that event forever. Re-key on event_index alone before it fires.
CREATE TABLE pool_liquidity_legs (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL,
  tx_hash BLOB NOT NULL,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  asset_a_id INTEGER,
  asset_b_id INTEGER,
  quantity_a TEXT,
  quantity_b TEXT,
  quantity_minted TEXT,
  quantity_destroyed TEXT,
  status TEXT
);

INSERT INTO
  pool_liquidity_legs
SELECT
  event_index,
  tx_index,
  tx_hash,
  block_index,
  block_time,
  source_id,
  kind,
  asset_a_id,
  asset_b_id,
  quantity_a,
  quantity_b,
  quantity_minted,
  quantity_destroyed,
  status
FROM
  pool_liquidity;

DROP TABLE pool_liquidity;

ALTER TABLE pool_liquidity_legs
RENAME TO pool_liquidity;

CREATE INDEX idx_pool_liquidity_block ON pool_liquidity (block_index, event_index);

CREATE INDEX idx_pool_liquidity_source ON pool_liquidity (source_id, block_index DESC);

CREATE INDEX idx_pool_liquidity_assets ON pool_liquidity (asset_a_id, asset_b_id, block_index DESC);

CREATE INDEX idx_pool_liquidity_tx ON pool_liquidity (tx_index);
