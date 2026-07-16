-- Frozen first-30-day market evidence for the New Radar shadow model.
CREATE TABLE asset_emergence (
  asset_id INTEGER PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  observation_cutoff INTEGER NOT NULL,
  observed_through INTEGER NOT NULL,
  finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),
  trades INTEGER NOT NULL DEFAULT 0,
  buyers INTEGER NOT NULL DEFAULT 0,
  sellers INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  late_buyers INTEGER NOT NULL DEFAULT 0,
  late_active_days INTEGER NOT NULL DEFAULT 0,
  market_span_days REAL NOT NULL DEFAULT 0,
  venues INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_asset_emergence_stage
  ON asset_emergence(finalized, issued_at DESC, asset_id);
