-- Finalize: stamp classification lives ONLY in tags (source='protocol', ingest-written). Drop the
-- asset_stamps overlay (its only tag-inexpressible field was the SRC-20 tick, which is meta-protocol detail
-- we deliberately don't index) and the derived stamp columns on the raw CP mirror + feature table. Keeps
-- the Counterparty tables unmolested: enhancements are tags/overlays, not columns on the 1:1 replica.

-- 1) promote the already-built computed stamp tags so the computed-tag rebuild never deletes them
UPDATE tags SET source='protocol'
  WHERE entity_type='asset' AND tag IN ('stamp','src20','src721','src101','src20_deploy');

-- 2) ensure full coverage + add the src20_deploy tag from the asset_stamps overlay before dropping it
INSERT OR IGNORE INTO tags(entity_type,entity_id,tag,source) SELECT 'asset',asset,'stamp','protocol' FROM asset_stamps;
INSERT OR IGNORE INTO tags(entity_type,entity_id,tag,source) SELECT 'asset',asset,'src20','protocol' FROM asset_stamps WHERE protocol='SRC-20';
INSERT OR IGNORE INTO tags(entity_type,entity_id,tag,source) SELECT 'asset',asset,'src721','protocol' FROM asset_stamps WHERE protocol='SRC-721';
INSERT OR IGNORE INTO tags(entity_type,entity_id,tag,source) SELECT 'asset',asset,'src101','protocol' FROM asset_stamps WHERE protocol='SRC-101';
INSERT OR IGNORE INTO tags(entity_type,entity_id,tag,source) SELECT 'asset',asset,'src20_deploy','protocol' FROM asset_stamps WHERE protocol='SRC-20' AND op='deploy';

DROP TABLE IF EXISTS asset_stamps;

-- 3) drop the derived stamp columns from the CP mirror (indexes first) and the feature table
DROP INDEX IF EXISTS idx_assets_stamp_protocol;
DROP INDEX IF EXISTS idx_assets_stamp_tick;
ALTER TABLE assets DROP COLUMN stamp;
ALTER TABLE assets DROP COLUMN stamp_protocol;
ALTER TABLE assets DROP COLUMN stamp_tick;
ALTER TABLE assets DROP COLUMN stamp_op;
ALTER TABLE asset_signals DROP COLUMN stamp;
ALTER TABLE asset_signals DROP COLUMN stamp_protocol;
