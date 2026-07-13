-- Address reads filter both sides of several one-to-many relationships. SQLite can
-- combine the two indexes for `left=? OR right=?`, but only when both legs are
-- indexed; without the indexes below it falls back to scanning the entire table.
-- Keep block_index in the key because the public lists return newest rows first.
CREATE INDEX IF NOT EXISTS idx_iss_issuer
  ON issuances(issuer, block_index DESC);

CREATE INDEX IF NOT EXISTS idx_dispe_source
  ON dispenses(source, block_index DESC);

CREATE INDEX IF NOT EXISTS idx_om_addr1
  ON order_matches(tx1_address, block_index DESC);

CREATE INDEX IF NOT EXISTS idx_sweeps_dest
  ON sweeps(destination, block_index DESC);
