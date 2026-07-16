-- First-sale milestones seek the earliest qualifying completed Counterparty trade. These partial
-- indexes avoid sorting/scanning the full cross-venue ledger for each hourly Firsts refresh.
CREATE INDEX IF NOT EXISTS idx_trades_first_xcp_1000
  ON trades(block_index, block_time, ref)
  WHERE currency='XCP' AND total>=1000 AND tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_first_xcp_10000
  ON trades(block_index, block_time, ref)
  WHERE currency='XCP' AND total>=10000 AND tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_first_btc_1
  ON trades(block_index, block_time, ref)
  WHERE currency='BTC' AND total>=1 AND tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_first_btc_10
  ON trades(block_index, block_time, ref)
  WHERE currency='BTC' AND total>=10 AND tx_hash IS NOT NULL;
