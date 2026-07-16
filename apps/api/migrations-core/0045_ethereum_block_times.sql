-- Ethereum block height cannot be converted to time with a constant average interval. Persist the
-- authoritative timestamp returned by eth_getBlockByNumber and join it into Emblem sale projections.
CREATE TABLE ethereum_blocks (
  block_number INTEGER PRIMARY KEY,
  block_time INTEGER NOT NULL
);

CREATE INDEX idx_emblem_sales_block_number ON emblem_sales(block_number)
  WHERE block_number IS NOT NULL;
