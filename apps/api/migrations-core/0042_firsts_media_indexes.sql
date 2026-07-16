-- Media-history firsts are derived from valid issuance descriptions, not mutable current asset state or
-- MIME values later backfilled by Counterparty. Narrow partial indexes keep those proofs cheap to replay.
CREATE INDEX IF NOT EXISTS idx_issuances_first_png_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB 'data:image/png*' OR description GLOB 'iVBORw0KGgo*'
    OR (LOWER(substr(description,1,6))='stamp:' AND substr(description,7,12)='iVBORw0KGgo')
    OR LOWER(description) GLOB '*.png*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_gif_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB 'data:image/gif*' OR description GLOB 'R0lGOD*'
    OR (LOWER(substr(description,1,6))='stamp:' AND substr(description,7,6)='R0lGOD')
    OR LOWER(description) GLOB '*.gif*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_mp4_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB 'data:video/mp4*' OR LOWER(description) GLOB '*.mp4*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_ipfs_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB '*/ipfs/*' OR LOWER(description) GLOB 'ipfs://*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_arweave_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND (
    LOWER(description) GLOB '*arweave.net/*' OR LOWER(description) GLOB '*.ar.io/*'
    OR LOWER(description) GLOB '*ardrive.net*'
  );

CREATE INDEX IF NOT EXISTS idx_issuances_first_ordinals_reference
  ON issuances(block_index, tx_index, event_index)
  WHERE status NOT LIKE 'invalid%' AND LOWER(description) GLOB '*ordinals.com/content/*';
