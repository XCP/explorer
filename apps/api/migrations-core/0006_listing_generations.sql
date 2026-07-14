CREATE TABLE emblem_listings_next (
  generation INTEGER NOT NULL DEFAULT 0,
  contract_id INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  asset_id INTEGER,
  order_id TEXT,
  marketplace TEXT,
  price_usd REAL,
  price_amount TEXT,
  currency_id INTEGER,
  url TEXT,
  expiry INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(generation, contract_id, token_id)
);

INSERT INTO emblem_listings_next(
  generation,contract_id,token_id,asset_id,order_id,marketplace,price_usd,
  price_amount,currency_id,url,expiry,updated_at
)
SELECT 0,contract_id,token_id,asset_id,order_id,marketplace,price_usd,
       price_amount,currency_id,url,expiry,updated_at
FROM emblem_listings;

DROP TABLE emblem_listings;
ALTER TABLE emblem_listings_next RENAME TO emblem_listings;
CREATE INDEX idx_emblem_listings_asset ON emblem_listings(generation, asset_id, price_usd);

INSERT INTO core_state(key,value) VALUES('emblem_listings_generation','0')
ON CONFLICT(key) DO NOTHING;
