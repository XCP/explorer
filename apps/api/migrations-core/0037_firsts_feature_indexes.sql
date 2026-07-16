-- Narrow historical feature lookups used by /v2/firsts. These partial indexes avoid walking the
-- issuance/send histories to find a handful of protocol activation examples on a cold cache.
CREATE INDEX idx_sends_memo_first
  ON sends(block_index, event_index)
  WHERE memo IS NOT NULL AND memo!='' AND status NOT LIKE 'invalid%';

CREATE INDEX idx_issuances_description_lock_first
  ON issuances(block_index, event_index)
  WHERE asset_events='lock_description' AND status NOT LIKE 'invalid%';

CREATE INDEX idx_dispensers_oracle_first
  ON dispensers(block_index, tx_index)
  WHERE oracle_address_id IS NOT NULL;
