CREATE INDEX idx_address_signals_survived
ON address_signals(survived_assets DESC) WHERE survived_assets>0;

CREATE INDEX idx_address_signals_clean_spend
ON address_signals(clean_btc_spent DESC) WHERE clean_btc_spent>0;

CREATE INDEX idx_asset_signals_clean_holders
ON asset_signals(holders DESC) WHERE low_quality=0 AND holders>0;
