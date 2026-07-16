-- MIME is defaulted to text/plain on legacy rows. Only a non-default MIME value represents content
-- that actually used Counterparty's inscription-aware encoding.
CREATE INDEX idx_issuances_inscription_first
  ON issuances(block_index, event_index)
  WHERE mime_type IS NOT NULL AND mime_type NOT IN ('','text/plain') AND status NOT LIKE 'invalid%';
