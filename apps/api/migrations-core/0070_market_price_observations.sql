-- Preserve independently attributable market evidence. Source identifies the provider; venue identifies market type.
CREATE TABLE market_price_observations (
  day TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  source TEXT NOT NULL,
  venue TEXT NOT NULL,
  price REAL NOT NULL CHECK(price>0),
  volume_base REAL NOT NULL CHECK(volume_base>=0),
  trades INTEGER NOT NULL CHECK(trades>=0),
  first_time INTEGER,
  last_time INTEGER,
  method TEXT NOT NULL,
  PRIMARY KEY(day,base_currency,quote_currency,source,venue)
);
CREATE INDEX idx_market_price_pair_day
  ON market_price_observations(base_currency,quote_currency,day DESC);

CREATE TABLE market_price_imports (
  source TEXT NOT NULL,
  venue TEXT NOT NULL,
  dataset TEXT NOT NULL,
  source_url TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  rows INTEGER NOT NULL CHECK(rows>=0),
  PRIMARY KEY(source,dataset,source_url)
);

INSERT INTO market_price_observations(
  day,base_currency,quote_currency,source,venue,price,volume_base,trades,method
)
SELECT day,'XCP','BTC','counterparty','dex',xcpbtc,
  CAST(COALESCE(volume_xcp,'0') AS REAL)/1e8,trades,'volume_weighted_median'
FROM xcp_btc_daily
WHERE 1
ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
  price=excluded.price,volume_base=excluded.volume_base,trades=excluded.trades,method=excluded.method
WHERE market_price_observations.price IS NOT excluded.price
  OR market_price_observations.volume_base IS NOT excluded.volume_base
  OR market_price_observations.trades IS NOT excluded.trades
  OR market_price_observations.method IS NOT excluded.method;
