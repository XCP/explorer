-- Complete the media-provider firsts with the same exact predicates used by the catalog.
-- These are historical issuance facts: invalid issuances are deliberately excluded.
CREATE INDEX IF NOT EXISTS idx_issuances_first_jpeg_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB 'data:image/jpeg*' OR description GLOB '/9j/*'
    OR LOWER(description) GLOB '*.jpg*' OR LOWER(description) GLOB '*.jpeg*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_svg_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB 'data:image/svg*' OR LOWER(description) GLOB '*.svg*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_ordinals_pointer
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB 'ord:*' OR LOWER(description) GLOB '*ordinals.com/content/*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_imgur_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND LOWER(description) GLOB '*imgur.com/*';
