ALTER TABLE asset_emergence ADD COLUMN fairmints INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_emergence ADD COLUMN minters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_emergence ADD COLUMN paid_minters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_emergence ADD COLUMN mint_active_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_emergence ADD COLUMN late_minters INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_fairmints_asset_time ON fairmints(asset_id, block_time);
