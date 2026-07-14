INSERT OR IGNORE INTO
  network_stats_snapshot (singleton)
VALUES
  (1);

UPDATE network_stats_snapshot
SET
  assets = (
    SELECT
      COUNT(*)
    FROM
      assets
  ),
  transactions = (
    SELECT
      COUNT(*)
    FROM
      transactions
  ),
  balances = (
    SELECT
      COUNT(*)
    FROM
      balances
  ),
  sends = (
    SELECT
      COUNT(*)
    FROM
      sends
  ),
  issuances = (
    SELECT
      COUNT(*)
    FROM
      issuances
  ),
  dispensers = (
    SELECT
      COUNT(*)
    FROM
      dispensers
  ),
  dispenses = (
    SELECT
      COUNT(*)
    FROM
      dispenses
  ),
  orders = (
    SELECT
      COUNT(*)
    FROM
      orders
  ),
  order_matches = (
    SELECT
      COUNT(*)
    FROM
      order_matches
  ),
  sweeps = (
    SELECT
      COUNT(*)
    FROM
      sweeps
  ),
  broadcasts = (
    SELECT
      COUNT(*)
    FROM
      broadcasts
  ),
  dividends = (
    SELECT
      COUNT(*)
    FROM
      dividends
  ),
  fairmints = (
    SELECT
      COUNT(*)
    FROM
      fairmints
  ),
  destructions = (
    SELECT
      COUNT(*)
    FROM
      destructions
  ),
  holders = (
    SELECT
      COUNT(*)
    FROM
      balances
    WHERE
      CAST(quantity AS INTEGER) > 0
  ),
  btc_fees = (
    SELECT
      coalesce(SUM(CAST(fee AS REAL)), 0) / 100000000.0
    FROM
      transactions
  ),
  xcp_destroyed = (
    SELECT
      coalesce(SUM(CAST(amount AS REAL)), 0) / 100000000.0
    FROM
      (
        SELECT
          fee_paid amount
        FROM
          issuances
        WHERE
          status LIKE 'valid%'
          AND fee_paid IS NOT NULL
        UNION ALL
        SELECT
          fee_paid
        FROM
          sweeps
        WHERE
          fee_paid IS NOT NULL
        UNION ALL
        SELECT
          fee_paid
        FROM
          dividends
        WHERE
          fee_paid IS NOT NULL
        UNION ALL
        SELECT
          destruction.quantity
        FROM
          destructions destruction
        WHERE
          destruction.asset_id = (
            SELECT
              asset_id
            FROM
              asset_dictionary
            WHERE
              asset = 'XCP'
          )
          AND destruction.status LIKE 'valid%'
      )
  ),
  xcp_supply = CAST(
    (
      SELECT
        coalesce(SUM(CAST(earned AS INTEGER)), 0)
      FROM
        burns
    ) - (
      SELECT
        coalesce(SUM(CAST(destruction.quantity AS INTEGER)), 0)
      FROM
        destructions destruction
      WHERE
        destruction.asset_id = (
          SELECT
            asset_id
          FROM
            asset_dictionary
          WHERE
            asset = 'XCP'
        )
        AND destruction.status LIKE 'valid%'
    ) - (
      SELECT
        coalesce(SUM(CAST(amount AS INTEGER)), 0)
      FROM
        (
          SELECT
            fee_paid amount
          FROM
            issuances
          WHERE
            status LIKE 'valid%'
            AND fee_paid IS NOT NULL
          UNION ALL
          SELECT
            fee_paid
          FROM
            sweeps
          WHERE
            fee_paid IS NOT NULL
          UNION ALL
          SELECT
            fee_paid
          FROM
            dividends
          WHERE
            fee_paid IS NOT NULL
        )
    ) AS TEXT
  ),
  updated_at = unixepoch()
WHERE
  singleton = 1;

CREATE TRIGGER stats_assets_insert AFTER INSERT ON assets BEGIN
UPDATE network_stats_snapshot
SET
  assets = assets + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_assets_delete AFTER DELETE ON assets BEGIN
UPDATE network_stats_snapshot
SET
  assets = max(0, assets -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_transactions_insert AFTER INSERT ON transactions BEGIN
UPDATE network_stats_snapshot
SET
  transactions = transactions + 1,
  btc_fees = btc_fees + coalesce(CAST(NEW.fee AS REAL), 0) / 100000000.0,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_transactions_delete AFTER DELETE ON transactions BEGIN
UPDATE network_stats_snapshot
SET
  transactions = max(0, transactions -1),
  btc_fees = btc_fees - coalesce(CAST(OLD.fee AS REAL), 0) / 100000000.0,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_balances_insert AFTER INSERT ON balances BEGIN
UPDATE network_stats_snapshot
SET
  balances = balances + 1,
  holders = holders + (CAST(NEW.quantity AS INTEGER) > 0),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_balances_delete AFTER DELETE ON balances BEGIN
UPDATE network_stats_snapshot
SET
  balances = max(0, balances -1),
  holders = max(0, holders - (CAST(OLD.quantity AS INTEGER) > 0)),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_balances_update AFTER
UPDATE OF quantity ON balances BEGIN
UPDATE network_stats_snapshot
SET
  holders = max(0, holders + (CAST(NEW.quantity AS INTEGER) > 0) - (CAST(OLD.quantity AS INTEGER) > 0)),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_sends_insert AFTER INSERT ON sends BEGIN
UPDATE network_stats_snapshot
SET
  sends = sends + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_sends_delete AFTER DELETE ON sends BEGIN
UPDATE network_stats_snapshot
SET
  sends = max(0, sends -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_dispensers_insert AFTER INSERT ON dispensers BEGIN
UPDATE network_stats_snapshot
SET
  dispensers = dispensers + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_dispensers_delete AFTER DELETE ON dispensers BEGIN
UPDATE network_stats_snapshot
SET
  dispensers = max(0, dispensers -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_dispenses_insert AFTER INSERT ON dispenses BEGIN
UPDATE network_stats_snapshot
SET
  dispenses = dispenses + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_dispenses_delete AFTER DELETE ON dispenses BEGIN
UPDATE network_stats_snapshot
SET
  dispenses = max(0, dispenses -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_orders_insert AFTER INSERT ON orders BEGIN
UPDATE network_stats_snapshot
SET
  orders = orders + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_orders_delete AFTER DELETE ON orders BEGIN
UPDATE network_stats_snapshot
SET
  orders = max(0, orders -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_matches_insert AFTER INSERT ON order_matches BEGIN
UPDATE network_stats_snapshot
SET
  order_matches = order_matches + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_matches_delete AFTER DELETE ON order_matches BEGIN
UPDATE network_stats_snapshot
SET
  order_matches = max(0, order_matches -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_broadcasts_insert AFTER INSERT ON broadcasts BEGIN
UPDATE network_stats_snapshot
SET
  broadcasts = broadcasts + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_broadcasts_delete AFTER DELETE ON broadcasts BEGIN
UPDATE network_stats_snapshot
SET
  broadcasts = max(0, broadcasts -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_fairmints_insert AFTER INSERT ON fairmints BEGIN
UPDATE network_stats_snapshot
SET
  fairmints = fairmints + 1,
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_fairmints_delete AFTER DELETE ON fairmints BEGIN
UPDATE network_stats_snapshot
SET
  fairmints = max(0, fairmints -1),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_issuances_insert AFTER INSERT ON issuances BEGIN
UPDATE network_stats_snapshot
SET
  issuances = issuances + 1,
  xcp_destroyed = xcp_destroyed + CASE
    WHEN NEW.status LIKE 'valid%' THEN coalesce(CAST(NEW.fee_paid AS REAL), 0) / 100000000.0
    ELSE 0
  END,
  xcp_supply = CAST(
    CAST(xcp_supply AS INTEGER) - CASE
      WHEN NEW.status LIKE 'valid%' THEN coalesce(CAST(NEW.fee_paid AS INTEGER), 0)
      ELSE 0
    END AS TEXT
  ),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_issuances_delete AFTER DELETE ON issuances BEGIN
UPDATE network_stats_snapshot
SET
  issuances = max(0, issuances -1),
  xcp_destroyed = xcp_destroyed - CASE
    WHEN OLD.status LIKE 'valid%' THEN coalesce(CAST(OLD.fee_paid AS REAL), 0) / 100000000.0
    ELSE 0
  END,
  xcp_supply = CAST(
    CAST(xcp_supply AS INTEGER) + CASE
      WHEN OLD.status LIKE 'valid%' THEN coalesce(CAST(OLD.fee_paid AS INTEGER), 0)
      ELSE 0
    END AS TEXT
  ),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_sweeps_insert AFTER INSERT ON sweeps BEGIN
UPDATE network_stats_snapshot
SET
  sweeps = sweeps + 1,
  xcp_destroyed = xcp_destroyed + coalesce(CAST(NEW.fee_paid AS REAL), 0) / 100000000.0,
  xcp_supply = CAST(CAST(xcp_supply AS INTEGER) - coalesce(CAST(NEW.fee_paid AS INTEGER), 0) AS TEXT),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_sweeps_delete AFTER DELETE ON sweeps BEGIN
UPDATE network_stats_snapshot
SET
  sweeps = max(0, sweeps -1),
  xcp_destroyed = xcp_destroyed - coalesce(CAST(OLD.fee_paid AS REAL), 0) / 100000000.0,
  xcp_supply = CAST(CAST(xcp_supply AS INTEGER) + coalesce(CAST(OLD.fee_paid AS INTEGER), 0) AS TEXT),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_dividends_insert AFTER INSERT ON dividends BEGIN
UPDATE network_stats_snapshot
SET
  dividends = dividends + 1,
  xcp_destroyed = xcp_destroyed + coalesce(CAST(NEW.fee_paid AS REAL), 0) / 100000000.0,
  xcp_supply = CAST(CAST(xcp_supply AS INTEGER) - coalesce(CAST(NEW.fee_paid AS INTEGER), 0) AS TEXT),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_dividends_delete AFTER DELETE ON dividends BEGIN
UPDATE network_stats_snapshot
SET
  dividends = max(0, dividends -1),
  xcp_destroyed = xcp_destroyed - coalesce(CAST(OLD.fee_paid AS REAL), 0) / 100000000.0,
  xcp_supply = CAST(CAST(xcp_supply AS INTEGER) + coalesce(CAST(OLD.fee_paid AS INTEGER), 0) AS TEXT),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_destructions_insert AFTER INSERT ON destructions BEGIN
UPDATE network_stats_snapshot
SET
  destructions = destructions + 1,
  xcp_destroyed = xcp_destroyed + CASE
    WHEN NEW.status LIKE 'valid%'
    AND NEW.asset_id = (
      SELECT
        asset_id
      FROM
        asset_dictionary
      WHERE
        asset = 'XCP'
    ) THEN coalesce(CAST(NEW.quantity AS REAL), 0) / 100000000.0
    ELSE 0
  END,
  xcp_supply = CAST(
    CAST(xcp_supply AS INTEGER) - CASE
      WHEN NEW.status LIKE 'valid%'
      AND NEW.asset_id = (
        SELECT
          asset_id
        FROM
          asset_dictionary
        WHERE
          asset = 'XCP'
      ) THEN coalesce(CAST(NEW.quantity AS INTEGER), 0)
      ELSE 0
    END AS TEXT
  ),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_destructions_delete AFTER DELETE ON destructions BEGIN
UPDATE network_stats_snapshot
SET
  destructions = max(0, destructions -1),
  xcp_destroyed = xcp_destroyed - CASE
    WHEN OLD.status LIKE 'valid%'
    AND OLD.asset_id = (
      SELECT
        asset_id
      FROM
        asset_dictionary
      WHERE
        asset = 'XCP'
    ) THEN coalesce(CAST(OLD.quantity AS REAL), 0) / 100000000.0
    ELSE 0
  END,
  xcp_supply = CAST(
    CAST(xcp_supply AS INTEGER) + CASE
      WHEN OLD.status LIKE 'valid%'
      AND OLD.asset_id = (
        SELECT
          asset_id
        FROM
          asset_dictionary
        WHERE
          asset = 'XCP'
      ) THEN coalesce(CAST(OLD.quantity AS INTEGER), 0)
      ELSE 0
    END AS TEXT
  ),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_burns_insert AFTER INSERT ON burns BEGIN
UPDATE network_stats_snapshot
SET
  xcp_supply = CAST(CAST(xcp_supply AS INTEGER) + coalesce(CAST(NEW.earned AS INTEGER), 0) AS TEXT),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;

CREATE TRIGGER stats_burns_delete AFTER DELETE ON burns BEGIN
UPDATE network_stats_snapshot
SET
  xcp_supply = CAST(CAST(xcp_supply AS INTEGER) - coalesce(CAST(OLD.earned AS INTEGER), 0) AS TEXT),
  updated_at = unixepoch()
WHERE
  singleton = 1;

END;
