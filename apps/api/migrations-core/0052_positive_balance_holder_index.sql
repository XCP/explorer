-- Holder-overlap reads only live balances. Excluding zeroed rows keeps related
-- asset lookups proportional to what each address currently owns.
CREATE INDEX idx_balances_positive_address_asset
ON balances(address_id,asset_id)
WHERE address_id IS NOT NULL AND CAST(quantity AS INTEGER)>0;
