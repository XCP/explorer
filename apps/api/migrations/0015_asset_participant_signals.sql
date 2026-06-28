-- Additive asset signals found in the 2026-06-27 sweep (each adds info beyond existing columns):
--   distinct_traders     — distinct order-match participants (wash-resistant breadth; lift 10.3x vs vaulted)
--   distinct_dispensers  — distinct dispenser operators (lift 3.98x)
--   age_blocks           — tip − first issuance (survivorship; lift 1.48x). Precomputed each rebuild.
--   avg_holder_dex       — avg DEX activity of the asset's holders (holder sophistication; lift 2.23x)
ALTER TABLE asset_signals ADD COLUMN distinct_traders INTEGER DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN distinct_dispensers INTEGER DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN age_blocks INTEGER DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN avg_holder_dex REAL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_as_dtraders ON asset_signals(distinct_traders);
