-- Buyer-verifiable, asset-attributable market evidence for Rating research.
-- These columns do not change the production Rating until the frozen challenger evaluation passes.
ALTER TABLE asset_signals ADD COLUMN clean_realized_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN distinct_paid_buyers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN clean_active_trade_months INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN market_venue_count INTEGER NOT NULL DEFAULT 0;

-- Existing history is small enough to aggregate once. Bundle payments remain in trades but do not enter this
-- direct-sale projection; incremental signal maintenance uses the identical predicate after migration.
INSERT INTO asset_signals(
  asset_id,clean_realized_usd,distinct_paid_buyers,clean_active_trade_months,market_venue_count
)
SELECT asset_id,
  COALESCE(SUM(CASE WHEN usd_value>0 THEN usd_value ELSE 0 END),0),
  COUNT(DISTINCT buyer_id),
  COUNT(DISTINCT strftime('%Y-%m',block_time,'unixepoch')),
  COUNT(DISTINCT venue)
FROM trades
WHERE asset_id IS NOT NULL AND block_time>0 AND total>0
  AND buyer_id IS NOT NULL AND seller_id IS NOT NULL AND buyer_id<>seller_id
  AND (venue='dex' OR (venue='dispense' AND sale_class='single')
    OR (venue='emblem' AND sale_class='real'))
GROUP BY asset_id
ON CONFLICT(asset_id) DO UPDATE SET
  clean_realized_usd=excluded.clean_realized_usd,
  distinct_paid_buyers=excluded.distinct_paid_buyers,
  clean_active_trade_months=excluded.clean_active_trade_months,
  market_venue_count=excluded.market_venue_count;
