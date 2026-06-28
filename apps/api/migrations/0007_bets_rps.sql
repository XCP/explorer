-- Completeness: legacy bets + RPS (rock-paper-scissors). Small/deprecated but real historical CP data.
-- Fund movements already flow via CREDIT/DEBIT; these record the bet/rps actions for the explorer.

CREATE TABLE IF NOT EXISTS bets (
  tx_hash                 TEXT PRIMARY KEY,
  block_index             INTEGER NOT NULL,
  block_time              INTEGER,
  source                  TEXT,
  feed_address            TEXT,
  bet_type                INTEGER,
  deadline                INTEGER,
  wager_quantity          TEXT,
  wager_remaining         TEXT,
  counterwager_quantity   TEXT,
  counterwager_remaining  TEXT,
  target_value            TEXT,
  leverage                INTEGER,
  expiration              INTEGER,
  expire_index            INTEGER,
  fee_fraction_int        TEXT,
  status                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_bets_block ON bets(block_index);
CREATE INDEX IF NOT EXISTS idx_bets_src   ON bets(source, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_bets_feed  ON bets(feed_address);

CREATE TABLE IF NOT EXISTS bet_matches (
  id                  TEXT PRIMARY KEY,
  tx0_hash            TEXT,
  tx0_address         TEXT,
  tx1_hash            TEXT,
  tx1_address         TEXT,
  feed_address        TEXT,
  forward_quantity    TEXT,
  backward_quantity   TEXT,
  deadline            INTEGER,
  target_value        TEXT,
  leverage            INTEGER,
  initial_value       TEXT,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  status              TEXT
);
CREATE INDEX IF NOT EXISTS idx_bm_block ON bet_matches(block_index);
CREATE INDEX IF NOT EXISTS idx_bm_feed  ON bet_matches(feed_address);

CREATE TABLE IF NOT EXISTS rps (
  tx_hash           TEXT PRIMARY KEY,
  block_index       INTEGER NOT NULL,
  block_time        INTEGER,
  source            TEXT,
  possible_moves    INTEGER,
  wager             TEXT,
  move_random_hash  TEXT,
  expiration        INTEGER,
  expire_index      INTEGER,
  status            TEXT
);
CREATE INDEX IF NOT EXISTS idx_rps_block ON rps(block_index);
CREATE INDEX IF NOT EXISTS idx_rps_src   ON rps(source, block_index DESC);

CREATE TABLE IF NOT EXISTS rps_matches (
  id                  TEXT PRIMARY KEY,
  tx0_hash            TEXT,
  tx0_address         TEXT,
  tx1_hash            TEXT,
  tx1_address         TEXT,
  possible_moves      INTEGER,
  wager               TEXT,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  status              TEXT
);
CREATE INDEX IF NOT EXISTS idx_rpsm_block ON rps_matches(block_index);
