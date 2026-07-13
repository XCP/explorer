ALTER TABLE fairminters ADD COLUMN pool_quantity TEXT;
ALTER TABLE fairminters ADD COLUMN lp_asset TEXT;

CREATE INDEX IF NOT EXISTS idx_fairminters_lp_asset
  ON fairminters(lp_asset)
  WHERE lp_asset IS NOT NULL;
