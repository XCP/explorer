-- CCSATOSHI introduced raw Base64 PNG bytes directly in a valid asset description. Keep the
-- independently derived milestone index-fast without conflating it with data URIs or Stamps.
CREATE INDEX IF NOT EXISTS idx_issuances_first_raw_base64_png
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND description GLOB 'iVBORw0KGgo*';
