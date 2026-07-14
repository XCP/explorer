-- Maintain exact asset activity counts at the canonical row boundary. Lifecycle UPSERT updates do not
-- change record identity; inserts add one logical record and reorg deletes remove it.
CREATE TRIGGER feed_issuances_insert AFTER INSERT ON issuances BEGIN
INSERT INTO
  asset_feed_counts (asset_id, issuances, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  issuances = issuances + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_issuances_delete AFTER DELETE ON issuances BEGIN
UPDATE asset_feed_counts
SET
  issuances = max(0, issuances -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

END;

CREATE TRIGGER feed_dispensers_insert AFTER INSERT ON dispensers BEGIN
INSERT INTO
  asset_feed_counts (asset_id, dispensers, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  dispensers = dispensers + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_dispensers_delete AFTER DELETE ON dispensers BEGIN
UPDATE asset_feed_counts
SET
  dispensers = max(0, dispensers -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

END;

CREATE TRIGGER feed_dispenses_insert AFTER INSERT ON dispenses BEGIN
INSERT INTO
  asset_feed_counts (asset_id, dispenses, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  dispenses = dispenses + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_dispenses_delete AFTER DELETE ON dispenses BEGIN
UPDATE asset_feed_counts
SET
  dispenses = max(0, dispenses -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

END;

CREATE TRIGGER feed_sends_insert AFTER INSERT ON sends BEGIN
INSERT INTO
  asset_feed_counts (asset_id, sends, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  sends = sends + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_sends_delete AFTER DELETE ON sends BEGIN
UPDATE asset_feed_counts
SET
  sends = max(0, sends -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

END;

CREATE TRIGGER feed_fairmints_insert AFTER INSERT ON fairmints BEGIN
INSERT INTO
  asset_feed_counts (asset_id, fairmints, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  fairmints = fairmints + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_fairmints_delete AFTER DELETE ON fairmints BEGIN
UPDATE asset_feed_counts
SET
  fairmints = max(0, fairmints -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

END;

CREATE TRIGGER feed_destructions_insert AFTER INSERT ON destructions BEGIN
INSERT INTO
  asset_feed_counts (asset_id, destructions, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  destructions = destructions + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_destructions_delete AFTER DELETE ON destructions BEGIN
UPDATE asset_feed_counts
SET
  destructions = max(0, destructions -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

END;

CREATE TRIGGER feed_trades_insert AFTER INSERT ON trades BEGIN
INSERT INTO
  asset_feed_counts (asset_id, sales, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  sales = sales + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_trades_delete AFTER DELETE ON trades BEGIN
UPDATE asset_feed_counts
SET
  sales = max(0, sales -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

END;

CREATE TRIGGER feed_orders_insert AFTER INSERT ON orders BEGIN
INSERT INTO
  asset_feed_counts (asset_id, orders, updated_at)
VALUES
  (NEW.give_asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  orders = orders + 1,
  updated_at = excluded.updated_at;

INSERT INTO
  asset_feed_counts (asset_id, orders, updated_at)
SELECT
  NEW.get_asset_id,
  1,
  unixepoch()
WHERE
  NEW.get_asset_id <> NEW.give_asset_id
ON CONFLICT (asset_id) DO UPDATE
SET
  orders = orders + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_orders_delete AFTER DELETE ON orders BEGIN
UPDATE asset_feed_counts
SET
  orders = max(0, orders -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.give_asset_id;

UPDATE asset_feed_counts
SET
  orders = max(0, orders -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.get_asset_id
  AND OLD.get_asset_id <> OLD.give_asset_id;

END;

CREATE TRIGGER feed_dividends_insert AFTER INSERT ON dividends BEGIN
INSERT INTO
  asset_feed_counts (asset_id, dividends, updated_at)
VALUES
  (NEW.asset_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  dividends = dividends + 1,
  updated_at = excluded.updated_at;

INSERT INTO
  asset_feed_counts (asset_id, dividends, updated_at)
SELECT
  NEW.dividend_asset_id,
  1,
  unixepoch()
WHERE
  NEW.dividend_asset_id <> NEW.asset_id
ON CONFLICT (asset_id) DO UPDATE
SET
  dividends = dividends + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_dividends_delete AFTER DELETE ON dividends BEGIN
UPDATE asset_feed_counts
SET
  dividends = max(0, dividends -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_id;

UPDATE asset_feed_counts
SET
  dividends = max(0, dividends -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.dividend_asset_id
  AND OLD.dividend_asset_id <> OLD.asset_id;

END;

CREATE TRIGGER feed_pools_insert AFTER INSERT ON pools BEGIN
INSERT INTO
  asset_feed_counts (asset_id, pools, updated_at)
VALUES
  (NEW.asset_a_id, 1, unixepoch())
ON CONFLICT (asset_id) DO UPDATE
SET
  pools = pools + 1,
  updated_at = excluded.updated_at;

INSERT INTO
  asset_feed_counts (asset_id, pools, updated_at)
SELECT
  NEW.asset_b_id,
  1,
  unixepoch()
WHERE
  NEW.asset_b_id <> NEW.asset_a_id
ON CONFLICT (asset_id) DO UPDATE
SET
  pools = pools + 1,
  updated_at = excluded.updated_at;

INSERT INTO
  asset_feed_counts (asset_id, pools, updated_at)
SELECT
  asset_id,
  1,
  unixepoch()
FROM
  asset_dictionary
WHERE
  asset = NEW.lp_asset
  AND asset_id NOT IN (NEW.asset_a_id, NEW.asset_b_id)
ON CONFLICT (asset_id) DO UPDATE
SET
  pools = pools + 1,
  updated_at = excluded.updated_at;

END;

CREATE TRIGGER feed_pools_delete AFTER DELETE ON pools BEGIN
UPDATE asset_feed_counts
SET
  pools = max(0, pools -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_a_id;

UPDATE asset_feed_counts
SET
  pools = max(0, pools -1),
  updated_at = unixepoch()
WHERE
  asset_id = OLD.asset_b_id
  AND OLD.asset_b_id <> OLD.asset_a_id;

UPDATE asset_feed_counts
SET
  pools = max(0, pools -1),
  updated_at = unixepoch()
WHERE
  asset_id = (
    SELECT
      asset_id
    FROM
      asset_dictionary
    WHERE
      asset = OLD.lp_asset
  )
  AND asset_id NOT IN (OLD.asset_a_id, OLD.asset_b_id);

END;

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
  NEW.asset_longname LIKE asset || '.%'
  AND asset <> NEW.asset_longname
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
      OLD.asset_longname LIKE asset || '.%'
  );

END;
