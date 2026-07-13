-- The exchange overview used to count distinct senders across the complete sends
-- history on every cache miss. Keep the small ranked result here and rebuild it
-- off the request path. Generations make publication atomic: readers see either
-- the complete previous result or the complete next result.
CREATE TABLE IF NOT EXISTS exchange_top_assets (
  generation INTEGER NOT NULL,
  asset TEXT NOT NULL,
  asset_longname TEXT,
  depositors INTEGER NOT NULL,
  PRIMARY KEY (generation, asset)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_exchange_top_assets_rank ON exchange_top_assets (generation, depositors DESC, asset);

INSERT INTO
  indexer_state (KEY, value)
VALUES
  ('exchange_top_assets_generation', '0')
ON CONFLICT (KEY) DO NOTHING;
