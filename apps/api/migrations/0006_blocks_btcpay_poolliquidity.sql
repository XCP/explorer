-- Completeness pass: full block metadata, BTCPay (completes BTC order matches), pool liquidity events.
ALTER TABLE blocks ADD COLUMN previous_block_hash TEXT;
ALTER TABLE blocks ADD COLUMN difficulty TEXT;

CREATE TABLE IF NOT EXISTS btcpays (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash               TEXT NOT NULL,
  block_index           INTEGER NOT NULL,
  block_time            INTEGER,
  source                TEXT,
  destination           TEXT,
  order_match_id        TEXT,
  btc_amount            TEXT,
  btc_amount_normalized TEXT,
  status                TEXT
);
CREATE INDEX IF NOT EXISTS idx_btcpay_block ON btcpays(block_index);
CREATE INDEX IF NOT EXISTS idx_btcpay_match ON btcpays(order_match_id);
CREATE INDEX IF NOT EXISTS idx_btcpay_src   ON btcpays(source, block_index DESC);

CREATE TABLE IF NOT EXISTS pool_liquidity (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash             TEXT NOT NULL,
  block_index         INTEGER NOT NULL,
  block_time          INTEGER,
  source              TEXT,
  kind                TEXT,            -- deposit | withdrawal
  asset_a             TEXT,
  asset_b             TEXT,
  quantity_a          TEXT,
  quantity_b          TEXT,
  quantity_minted     TEXT,
  status              TEXT
);
CREATE INDEX IF NOT EXISTS idx_poolliq_block ON pool_liquidity(block_index);
CREATE INDEX IF NOT EXISTS idx_poolliq_src   ON pool_liquidity(source, block_index DESC);
