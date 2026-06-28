-- Recency for assets (2026-06-28 lab): trailing activity reward + staleness DECAY.
--   recent_events   — trailing-~12mo trades+dispenses (current relevance; lift 6.59x vs vaulted). Additive +.
--   recency_blocks  — tip − last_trade_block (precomputed each cycle). Drives the DECAY multiplier on the
--                     legacy time-terms (durability, age): a once-active asset gone quiet decays toward
--                     dormant instead of coasting on historical standing. (Address decay uses last_blk, no col.)
ALTER TABLE asset_signals ADD COLUMN recent_events INTEGER DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN recency_blocks INTEGER DEFAULT 0;
