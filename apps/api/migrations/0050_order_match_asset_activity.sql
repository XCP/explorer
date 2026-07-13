-- Asset activity and market reads filter either side of an order match. Cover
-- the monthly bucket timestamp so each branch can aggregate from the index
-- without scanning the complete match table or reading the base row.
CREATE INDEX IF NOT EXISTS idx_om_forward_activity
  ON order_matches(forward_asset, block_time);

CREATE INDEX IF NOT EXISTS idx_om_backward_activity
  ON order_matches(backward_asset, block_time);
