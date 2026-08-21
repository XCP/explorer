-- A pool swap is a fill, not a transaction: one routed order can sweep the same pool several
-- times inside a single tx (first seen at block 963242, tx 3172909 — two POOL_MATCH events, one
-- tx_hash). The UNIQUE(tx_index)/UNIQUE(tx_hash) constraints made the second fill's insert throw,
-- which aborted the whole replay batch and froze the mirror at event 20449775 while retries hit
-- the same event forever. event_index (the primary key) is the row's real identity; rebuild the
-- table without the per-tx uniqueness and keep a plain tx_index index for the tx-detail lookup.
CREATE TABLE pool_match_fills (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL,
  tx_hash BLOB NOT NULL,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  lp_asset TEXT,
  pair TEXT,
  forward_asset_id INTEGER,
  forward_quantity TEXT,
  backward_asset_id INTEGER,
  backward_quantity TEXT,
  fee_quantity TEXT,
  fee_bps INTEGER,
  order_tx_index INTEGER,
  status TEXT
);

INSERT INTO
  pool_match_fills
SELECT
  event_index,
  tx_index,
  tx_hash,
  block_index,
  block_time,
  source_id,
  lp_asset,
  pair,
  forward_asset_id,
  forward_quantity,
  backward_asset_id,
  backward_quantity,
  fee_quantity,
  fee_bps,
  order_tx_index,
  status
FROM
  pool_matches;

DROP TABLE pool_matches;

ALTER TABLE pool_match_fills
RENAME TO pool_matches;

CREATE INDEX idx_pool_matches_block ON pool_matches (block_index, event_index);

CREATE INDEX idx_pool_matches_source ON pool_matches (source_id, block_index DESC);

CREATE INDEX idx_pool_matches_forward_asset ON pool_matches (forward_asset_id, block_index DESC);

CREATE INDEX idx_pool_matches_tx ON pool_matches (tx_index);
