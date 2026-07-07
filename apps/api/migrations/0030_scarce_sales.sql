-- Scarce.city sales — the Bitcoin-native card marketplace, a venue our Ethereum/Alchemy Emblem crawl
-- is entirely blind to. Rebuilt from scarce.city's live API (the old app's ProcessScarceCityTradeHistoryJob
-- source: GET /api/marketplace/digital/{asset}/sales). Staging table; materializes into `trades`
-- as venue='scarce.city' (BTC-priced). One row per sale; idempotent on (asset, sold_at).
CREATE TABLE IF NOT EXISTS scarce_city_sales (
  asset     TEXT NOT NULL,
  sold_at   INTEGER NOT NULL,   -- unix seconds (from the API's RFC-1123 timestamp)
  price_btc REAL NOT NULL,      -- priceInBtc as reported
  PRIMARY KEY (asset, sold_at)
);
CREATE INDEX IF NOT EXISTS idx_scarce_asset ON scarce_city_sales(asset);
