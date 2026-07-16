-- Leaderboard boards return twelve qualifying rows. Keep their work proportional
-- to that result instead of sorting the complete address population.
CREATE INDEX idx_address_signals_assets_held
ON address_signals(assets_held DESC,address_id)
WHERE assets_held>0;

CREATE INDEX idx_address_signals_survived_assets
ON address_signals(survived_assets DESC,address_id)
WHERE survived_assets>0;

CREATE INDEX idx_address_signals_stamps_created
ON address_signals(stamps_created DESC,address_id)
WHERE stamps_created>0;

CREATE INDEX idx_address_signals_stamps_collected
ON address_signals(stamps_collected DESC,address_id)
WHERE stamps_collected>0;

CREATE INDEX idx_address_signals_src20_deploys
ON address_signals(src20_deploys DESC,address_id)
WHERE src20_deploys>0;
