-- The subasset feed triggers matched the parent with NEW.asset_longname LIKE asset || '.%' — a
-- pattern derived per dictionary row, so every subasset issuance full-scanned all ~533k dictionary
-- rows inside the insert (~144M billed D1 reads/day on the sync lane). A longname's parent is the
-- text before its FIRST dot, and Counterparty asset names never contain dots, so the LIKE can only
-- ever match that one parent — an indexed seek says the same thing.
DROP TRIGGER feed_subassets_insert;

DROP TRIGGER feed_subassets_delete;

CREATE TRIGGER feed_subassets_insert AFTER INSERT ON assets WHEN NEW.asset_longname IS NOT NULL BEGIN
INSERT INTO
  asset_feed_counts (asset_id, subassets, updated_at)
SELECT
  asset_id,
  1,
  unixepoch()
FROM
  asset_dictionary
WHERE
  instr (NEW.asset_longname, '.') > 0
  AND asset = substr (NEW.asset_longname, 1, instr (NEW.asset_longname, '.') - 1)
ON CONFLICT (asset_id) DO UPDATE
SET
  subassets = subassets + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_subassets_delete AFTER DELETE ON assets WHEN OLD.asset_longname IS NOT NULL BEGIN
UPDATE asset_feed_counts
SET
  subassets = max(0, subassets -1),
  updated_at = unixepoch()
WHERE
  asset_id IN (
    SELECT
      asset_id
    FROM
      asset_dictionary
    WHERE
      instr (OLD.asset_longname, '.') > 0
      AND asset = substr (OLD.asset_longname, 1, instr (OLD.asset_longname, '.') - 1)
  );

END;
