ALTER TABLE asset_signals ADD COLUMN active_trade_months INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN last_trade_time INTEGER;
