-- Aggregate-provider quote volume is not attributable base execution volume. Preserve it separately.
ALTER TABLE market_price_observations ADD COLUMN reported_volume_quote REAL
  CHECK(reported_volume_quote IS NULL OR reported_volume_quote>=0);
ALTER TABLE market_price_observations ADD COLUMN reported_market_cap_quote REAL
  CHECK(reported_market_cap_quote IS NULL OR reported_market_cap_quote>=0);
