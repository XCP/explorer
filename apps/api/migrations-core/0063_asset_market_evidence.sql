-- Buyer-verifiable, asset-attributable market evidence for Rating research.
-- These columns do not change the production Rating until the frozen challenger evaluation passes.
ALTER TABLE asset_signals ADD COLUMN clean_realized_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN distinct_paid_buyers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN clean_active_trade_months INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN market_venue_count INTEGER NOT NULL DEFAULT 0;
