CREATE TABLE address_reputations (
  address_id INTEGER PRIMARY KEY,
  reputation REAL NOT NULL,
  rank_position INTEGER NOT NULL,
  population INTEGER NOT NULL,
  duration_score REAL NOT NULL,
  creation_score REAL NOT NULL,
  economic_score REAL NOT NULL,
  participation_score REAL NOT NULL,
  calculated_at INTEGER NOT NULL,
  model_version INTEGER NOT NULL
);

CREATE INDEX idx_address_reputations_rank
ON address_reputations(reputation DESC,address_id);

INSERT INTO core_state(key,value) VALUES('address_reputations_refreshed_at','0')
ON CONFLICT(key) DO UPDATE SET value='0';
