-- Production Insights showed only a ~1% read reduction for holder overlap while
-- this index consumed ~19 MB and added balance-write maintenance. The existing
-- unique holder/asset index remains the better storage/performance trade.
DROP INDEX idx_balances_positive_address_asset;
