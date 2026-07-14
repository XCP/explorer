-- Asset detail accounting begins with the asset and then checks address classification.
-- The identity uniqueness index has the inverse order and cannot serve this lookup.
CREATE INDEX idx_balances_asset_address
  ON balances(asset_id, address_id)
  WHERE address_id IS NOT NULL;
