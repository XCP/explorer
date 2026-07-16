CREATE TABLE asset_activity_outlook (
  asset_id INTEGER PRIMARY KEY,
  score REAL NOT NULL,
  rank_position INTEGER NOT NULL,
  population INTEGER NOT NULL,
  calculated_at INTEGER NOT NULL
);

CREATE INDEX idx_asset_activity_outlook_rank ON asset_activity_outlook(rank_position);
