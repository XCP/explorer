-- Holder cohesion: interaction edges among an asset's top holders ÷ holder count — a standalone coordination
-- signal (organic ≈ <1; a wash/sybil/clique ring runs many× that because the same wallets trade among
-- themselves). Batch-computed by indexer/holder-cohesion.ts over assets with a measurable holder base; NULL
-- until built. `_edges`/`_strong` keep the raw counts so the UI can show "N repeated ties" without recompute.
ALTER TABLE asset_signals ADD COLUMN holder_cohesion REAL;
ALTER TABLE asset_signals ADD COLUMN cohesion_edges INTEGER;
ALTER TABLE asset_signals ADD COLUMN cohesion_strong INTEGER;
