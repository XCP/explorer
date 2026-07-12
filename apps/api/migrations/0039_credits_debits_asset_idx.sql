-- Per-asset "most active users" (credits+debits count by address, on the Activity tab) needs to seek by
-- asset then group by address. Without an asset index the ledger scan is the full 4.26M/1.86M rows and D1
-- trips its CPU limit. Composite (asset, address) serves both the filter and the GROUP BY as an index scan.
CREATE INDEX IF NOT EXISTS idx_credits_asset_address ON credits(asset, address);
CREATE INDEX IF NOT EXISTS idx_debits_asset_address ON debits(asset, address);
