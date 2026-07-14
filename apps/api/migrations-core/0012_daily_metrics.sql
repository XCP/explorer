CREATE TABLE daily_metrics (
  day INTEGER PRIMARY KEY,
  transactions INTEGER,
  issuances INTEGER,
  dispenses INTEGER,
  trades INTEGER,
  sends INTEGER,
  btc_fees REAL,
  xcp_burned REAL
);

INSERT INTO
  daily_metrics (day, transactions)
SELECT
  block_time / 86400,
  SUM(transaction_count)
FROM
  blocks
WHERE
  block_time > 0
GROUP BY
  block_time / 86400;

INSERT INTO
  daily_metrics (day, issuances)
SELECT
  block_time / 86400,
  COUNT(*)
FROM
  issuances
WHERE
  block_time > 0
GROUP BY
  block_time / 86400
ON CONFLICT (day) DO UPDATE
SET
  issuances = excluded.issuances;

INSERT INTO
  daily_metrics (day, dispenses)
SELECT
  block_time / 86400,
  COUNT(*)
FROM
  dispenses
WHERE
  block_time > 0
GROUP BY
  block_time / 86400
ON CONFLICT (day) DO UPDATE
SET
  dispenses = excluded.dispenses;

INSERT INTO
  daily_metrics (day, trades)
SELECT
  block_time / 86400,
  COUNT(*)
FROM
  order_matches
WHERE
  block_time > 0
GROUP BY
  block_time / 86400
ON CONFLICT (day) DO UPDATE
SET
  trades = excluded.trades;

INSERT INTO
  daily_metrics (day, sends)
SELECT
  block_time / 86400,
  COUNT(*)
FROM
  sends
WHERE
  block_time > 0
GROUP BY
  block_time / 86400
ON CONFLICT (day) DO UPDATE
SET
  sends = excluded.sends;

INSERT INTO
  daily_metrics (day, btc_fees)
SELECT
  block_time / 86400,
  SUM(CAST(fee AS REAL)) / 100000000.0
FROM
  transactions
WHERE
  block_time > 0
  AND fee IS NOT NULL
GROUP BY
  block_time / 86400
ON CONFLICT (day) DO UPDATE
SET
  btc_fees = excluded.btc_fees;

INSERT INTO
  daily_metrics (day, xcp_burned)
SELECT
  block_time / 86400,
  SUM(CAST(amount AS REAL)) / 100000000.0
FROM
  (
    SELECT
      block_time,
      fee_paid amount
    FROM
      issuances
    WHERE
      status LIKE 'valid%'
      AND fee_paid IS NOT NULL
    UNION ALL
    SELECT
      block_time,
      fee_paid
    FROM
      sweeps
    WHERE
      fee_paid IS NOT NULL
    UNION ALL
    SELECT
      block_time,
      fee_paid
    FROM
      dividends
    WHERE
      fee_paid IS NOT NULL
    UNION ALL
    SELECT
      destruction.block_time,
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
WHERE
  block_time > 0
GROUP BY
  block_time / 86400
ON CONFLICT (day) DO UPDATE
SET
  xcp_burned = excluded.xcp_burned;

CREATE TRIGGER daily_blocks_insert AFTER INSERT ON blocks WHEN NEW.block_time > 0 BEGIN
INSERT INTO
  daily_metrics (day, transactions)
VALUES
  (NEW.block_time / 86400, NEW.transaction_count)
ON CONFLICT (day) DO UPDATE
SET
  transactions = coalesce(transactions, 0) + excluded.transactions;

END;

CREATE TRIGGER daily_blocks_delete AFTER DELETE ON blocks WHEN OLD.block_time > 0 BEGIN
UPDATE daily_metrics
SET
  transactions = nullif(transactions - OLD.transaction_count, 0)
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_issuances_insert AFTER INSERT ON issuances WHEN NEW.block_time > 0 BEGIN
INSERT INTO
  daily_metrics (day, issuances, xcp_burned)
VALUES
  (
    NEW.block_time / 86400,
    1,
    CASE
      WHEN NEW.status LIKE 'valid%'
      AND NEW.fee_paid IS NOT NULL THEN CAST(NEW.fee_paid AS REAL) / 100000000.0
    END
  )
ON CONFLICT (day) DO UPDATE
SET
  issuances = coalesce(issuances, 0) + 1,
  xcp_burned = coalesce(xcp_burned, 0) + coalesce(excluded.xcp_burned, 0);

END;

CREATE TRIGGER daily_issuances_delete AFTER DELETE ON issuances WHEN OLD.block_time > 0 BEGIN
UPDATE daily_metrics
SET
  issuances = nullif(issuances -1, 0),
  xcp_burned = CASE
    WHEN OLD.status LIKE 'valid%'
    AND OLD.fee_paid IS NOT NULL THEN nullif(xcp_burned - CAST(OLD.fee_paid AS REAL) / 100000000.0, 0)
    ELSE xcp_burned
  END
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_dispenses_insert AFTER INSERT ON dispenses WHEN NEW.block_time > 0 BEGIN
INSERT INTO
  daily_metrics (day, dispenses)
VALUES
  (NEW.block_time / 86400, 1)
ON CONFLICT (day) DO UPDATE
SET
  dispenses = coalesce(dispenses, 0) + 1;

END;

CREATE TRIGGER daily_dispenses_delete AFTER DELETE ON dispenses WHEN OLD.block_time > 0 BEGIN
UPDATE daily_metrics
SET
  dispenses = nullif(dispenses -1, 0)
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_matches_insert AFTER INSERT ON order_matches WHEN NEW.block_time > 0 BEGIN
INSERT INTO
  daily_metrics (day, trades)
VALUES
  (NEW.block_time / 86400, 1)
ON CONFLICT (day) DO UPDATE
SET
  trades = coalesce(trades, 0) + 1;

END;

CREATE TRIGGER daily_matches_delete AFTER DELETE ON order_matches WHEN OLD.block_time > 0 BEGIN
UPDATE daily_metrics
SET
  trades = nullif(trades -1, 0)
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_sends_insert AFTER INSERT ON sends WHEN NEW.block_time > 0 BEGIN
INSERT INTO
  daily_metrics (day, sends)
VALUES
  (NEW.block_time / 86400, 1)
ON CONFLICT (day) DO UPDATE
SET
  sends = coalesce(sends, 0) + 1;

END;

CREATE TRIGGER daily_sends_delete AFTER DELETE ON sends WHEN OLD.block_time > 0 BEGIN
UPDATE daily_metrics
SET
  sends = nullif(sends -1, 0)
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_transactions_insert AFTER INSERT ON transactions WHEN NEW.block_time > 0
AND NEW.fee IS NOT NULL BEGIN
INSERT INTO
  daily_metrics (day, btc_fees)
VALUES
  (NEW.block_time / 86400, CAST(NEW.fee AS REAL) / 100000000.0)
ON CONFLICT (day) DO UPDATE
SET
  btc_fees = coalesce(btc_fees, 0) + excluded.btc_fees;

END;

CREATE TRIGGER daily_transactions_delete AFTER DELETE ON transactions WHEN OLD.block_time > 0
AND OLD.fee IS NOT NULL BEGIN
UPDATE daily_metrics
SET
  btc_fees = nullif(btc_fees - CAST(OLD.fee AS REAL) / 100000000.0, 0)
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_sweeps_insert AFTER INSERT ON sweeps WHEN NEW.block_time > 0
AND NEW.fee_paid IS NOT NULL BEGIN
INSERT INTO
  daily_metrics (day, xcp_burned)
VALUES
  (NEW.block_time / 86400, CAST(NEW.fee_paid AS REAL) / 100000000.0)
ON CONFLICT (day) DO UPDATE
SET
  xcp_burned = coalesce(xcp_burned, 0) + excluded.xcp_burned;

END;

CREATE TRIGGER daily_sweeps_delete AFTER DELETE ON sweeps WHEN OLD.block_time > 0
AND OLD.fee_paid IS NOT NULL BEGIN
UPDATE daily_metrics
SET
  xcp_burned = nullif(xcp_burned - CAST(OLD.fee_paid AS REAL) / 100000000.0, 0)
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_dividends_insert AFTER INSERT ON dividends WHEN NEW.block_time > 0
AND NEW.fee_paid IS NOT NULL BEGIN
INSERT INTO
  daily_metrics (day, xcp_burned)
VALUES
  (NEW.block_time / 86400, CAST(NEW.fee_paid AS REAL) / 100000000.0)
ON CONFLICT (day) DO UPDATE
SET
  xcp_burned = coalesce(xcp_burned, 0) + excluded.xcp_burned;

END;

CREATE TRIGGER daily_dividends_delete AFTER DELETE ON dividends WHEN OLD.block_time > 0
AND OLD.fee_paid IS NOT NULL BEGIN
UPDATE daily_metrics
SET
  xcp_burned = nullif(xcp_burned - CAST(OLD.fee_paid AS REAL) / 100000000.0, 0)
WHERE
  day = OLD.block_time / 86400;

END;

CREATE TRIGGER daily_destructions_insert AFTER INSERT ON destructions WHEN NEW.block_time > 0
AND NEW.status LIKE 'valid%'
AND NEW.quantity IS NOT NULL
AND NEW.asset_id = (
  SELECT
    asset_id
  FROM
    asset_dictionary
  WHERE
    asset = 'XCP'
) BEGIN
INSERT INTO
  daily_metrics (day, xcp_burned)
VALUES
  (NEW.block_time / 86400, CAST(NEW.quantity AS REAL) / 100000000.0)
ON CONFLICT (day) DO UPDATE
SET
  xcp_burned = coalesce(xcp_burned, 0) + excluded.xcp_burned;

END;

CREATE TRIGGER daily_destructions_delete AFTER DELETE ON destructions WHEN OLD.block_time > 0
AND OLD.status LIKE 'valid%'
AND OLD.quantity IS NOT NULL
AND OLD.asset_id = (
  SELECT
    asset_id
  FROM
    asset_dictionary
  WHERE
    asset = 'XCP'
) BEGIN
UPDATE daily_metrics
SET
  xcp_burned = nullif(xcp_burned - CAST(OLD.quantity AS REAL) / 100000000.0, 0)
WHERE
  day = OLD.block_time / 86400;

END;
