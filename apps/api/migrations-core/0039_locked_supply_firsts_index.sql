-- Supply-at-lock milestones walk only accepted lock events, then reconstruct each candidate's net supply
-- from its own indexed issuance/destruction history.
CREATE INDEX idx_issuances_valid_lock_first
  ON issuances(block_index, event_index, asset_id)
  WHERE locked=1 AND status NOT LIKE 'invalid%';
