-- Formalize the trades ledger + USD price calendar as migrations (they were DDL-in-code at birth;
-- CLAUDE.md rule 8: schema lives in migrations). IF NOT EXISTS because prod already has both.

CREATE TABLE IF NOT EXISTS trades (
  venue       TEXT NOT NULL,               -- 'dex' | 'dispense' | 'emblem'
  ref         TEXT NOT NULL,               -- dedupe key within venue (source row id / tx_log)
  asset       TEXT,                        -- the CP card (NULL if unattributable)
  block_time  INTEGER,                     -- unix seconds (Emblem: approximated from ETH block)
  block_index INTEGER,                     -- CP block, or ETH block_number for Emblem
  quantity    REAL,                        -- units of asset
  currency    TEXT,                        -- 'XCP' | 'BTC' | 'ETH' | 'USDC'
  total       REAL,                        -- price paid, in currency
  price       REAL GENERATED ALWAYS AS (CASE WHEN quantity > 0 THEN total / quantity END) VIRTUAL,
  usd_value   REAL,                        -- total in USD (nullable; filled by the prices backfill)
  buyer TEXT, seller TEXT, tx_hash TEXT,
  PRIMARY KEY (venue, ref)
);
CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_trades_venue ON trades(venue, block_time DESC);

CREATE TABLE IF NOT EXISTS prices (
  day TEXT NOT NULL, currency TEXT NOT NULL, usd REAL, PRIMARY KEY (day, currency)
);
CREATE INDEX IF NOT EXISTS idx_prices_cur_day ON prices(currency, day);
