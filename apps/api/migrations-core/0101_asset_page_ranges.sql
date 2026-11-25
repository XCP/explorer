-- Each range stores its exact number of listable rows (assets joined to the name
-- dictionary). Keep one counter per range so OFFSET clients can skip whole ranges.
CREATE TABLE asset_page_ranges (
  first_name TEXT PRIMARY KEY,
  members INTEGER NOT NULL CHECK (members >= 0)
) WITHOUT ROWID;

WITH numbered AS (
  SELECT d.asset, (row_number() OVER (ORDER BY d.asset) - 1) / 512 AS bucket
  FROM asset_dictionary d CROSS JOIN assets a ON a.asset_id = d.asset_id
)
INSERT INTO asset_page_ranges(first_name, members)
SELECT CASE WHEN bucket = 0 THEN '' ELSE MIN(asset) END, COUNT(*)
FROM numbered GROUP BY bucket;
INSERT OR IGNORE INTO asset_page_ranges VALUES ('', 0);

-- Split only the range which grew. This also bounds ranges on a fresh database
-- that ran the migration before ingesting any assets.
CREATE TRIGGER asset_page_split AFTER UPDATE OF members ON asset_page_ranges
WHEN NEW.members > 1024
BEGIN
  INSERT INTO asset_page_ranges(first_name, members)
  SELECT d.asset, NEW.members - 512
  FROM asset_dictionary d CROSS JOIN assets a ON a.asset_id = d.asset_id
  WHERE d.asset >= NEW.first_name ORDER BY d.asset LIMIT 1 OFFSET 512;
  UPDATE asset_page_ranges SET members = 512 WHERE first_name = NEW.first_name;
END;

CREATE TRIGGER asset_page_remove_empty AFTER UPDATE OF members ON asset_page_ranges
WHEN NEW.members = 0 AND NEW.first_name <> ''
BEGIN
  DELETE FROM asset_page_ranges WHERE first_name = NEW.first_name;
END;

CREATE TRIGGER asset_page_asset_insert AFTER INSERT ON assets
BEGIN
  UPDATE asset_page_ranges SET members = members + 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= (SELECT asset FROM asset_dictionary WHERE asset_id = NEW.asset_id));
END;

CREATE TRIGGER asset_page_asset_delete AFTER DELETE ON assets
BEGIN
  UPDATE asset_page_ranges SET members = members - 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= (SELECT asset FROM asset_dictionary WHERE asset_id = OLD.asset_id));
END;

CREATE TRIGGER asset_page_asset_update AFTER UPDATE OF asset_id ON assets
WHEN OLD.asset_id <> NEW.asset_id
BEGIN
  UPDATE asset_page_ranges SET members = members - 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= (SELECT asset FROM asset_dictionary WHERE asset_id = OLD.asset_id));
  UPDATE asset_page_ranges SET members = members + 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= (SELECT asset FROM asset_dictionary WHERE asset_id = NEW.asset_id));
END;

CREATE TRIGGER asset_page_name_insert AFTER INSERT ON asset_dictionary
BEGIN
  UPDATE asset_page_ranges SET members = members + 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= NEW.asset)
    AND EXISTS (SELECT 1 FROM assets WHERE asset_id = NEW.asset_id);
END;

CREATE TRIGGER asset_page_name_delete AFTER DELETE ON asset_dictionary
BEGIN
  UPDATE asset_page_ranges SET members = members - 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= OLD.asset)
    AND EXISTS (SELECT 1 FROM assets WHERE asset_id = OLD.asset_id);
END;

CREATE TRIGGER asset_page_name_update AFTER UPDATE OF asset_id, asset ON asset_dictionary
WHEN OLD.asset_id <> NEW.asset_id OR OLD.asset <> NEW.asset
BEGIN
  UPDATE asset_page_ranges SET members = members - 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= OLD.asset)
    AND EXISTS (SELECT 1 FROM assets WHERE asset_id = OLD.asset_id);
  UPDATE asset_page_ranges SET members = members + 1
  WHERE first_name = (SELECT MAX(first_name) FROM asset_page_ranges
    WHERE first_name <= NEW.asset)
    AND EXISTS (SELECT 1 FROM assets WHERE asset_id = NEW.asset_id);
END;
