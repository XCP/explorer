-- First-sale milestones are unit-price milestones, not aggregate trade-volume milestones.
-- Create the corrected indexes before retiring the misleading total-volume indexes.
CREATE INDEX IF NOT EXISTS idx_trades_first_xcp_unit_1000
  ON trades(block_index, block_time, ref)
  WHERE currency='XCP' AND price>=1000 AND tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_first_xcp_unit_10000
  ON trades(block_index, block_time, ref)
  WHERE currency='XCP' AND price>=10000 AND tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_first_btc_unit_1
  ON trades(block_index, block_time, ref)
  WHERE currency='BTC' AND price>=1 AND tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_first_btc_unit_10
  ON trades(block_index, block_time, ref)
  WHERE currency='BTC' AND price>=10 AND tx_hash IS NOT NULL;

DROP INDEX IF EXISTS idx_trades_first_xcp_1000;
DROP INDEX IF EXISTS idx_trades_first_xcp_10000;
DROP INDEX IF EXISTS idx_trades_first_btc_1;
DROP INDEX IF EXISTS idx_trades_first_btc_10;
