-- Active Emblem-vault listings on Ethereum — the ETH-side "buyable now" for a Counterparty asset.
-- Source-agnostic (Sequence Marketplace API aggregates OpenSea/Blur/Magic Eden; OpenSea API v2 is the
-- fallback). One row per vault token that currently has a live ask; the crawler upserts fresh asks and
-- prunes rows not seen in the latest sweep (or past expiry). `asset` is the wrapped Counterparty card,
-- mapped from emblem_vaults.token_id — that's the join key into the Radar's cheapest-path merge.
CREATE TABLE IF NOT EXISTS emblem_listings (
  token_id     TEXT NOT NULL,      -- Emblem vault ERC-721 token id (decimal, matches emblem_vaults.token_id)
  contract     TEXT NOT NULL,      -- Emblem ERC-721 contract address (lowercase)
  asset        TEXT,               -- wrapped Counterparty asset (from emblem_vaults.contents_asset), if known
  order_id     TEXT,               -- marketplace order id (for dedupe / linking)
  marketplace  TEXT,               -- source venue: opensea | blur | magic_eden | sequence | …
  price_usd    REAL,               -- ask converted to USD (provided directly by the aggregator)
  price_amount TEXT,               -- raw ask amount in the listing currency (BigInt as text)
  currency     TEXT,               -- listing currency contract address (0x0…0 = native ETH)
  url          TEXT,               -- deep link to the live listing, for the "buy" action
  expiry       INTEGER,            -- unix expiry of the order (0/NULL = none)
  updated_at   INTEGER NOT NULL,   -- unix time this row was last confirmed live (stale-prune anchor)
  PRIMARY KEY (contract, token_id)
);
-- Radar joins by wrapped asset and takes the cheapest live ask per asset.
CREATE INDEX IF NOT EXISTS idx_emblem_listings_asset ON emblem_listings(asset, price_usd);
