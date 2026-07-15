-- Cut over to Bitcoin-authoritative fees after the staging backfill reaches zero missing rows.
DROP TRIGGER daily_transactions_insert;
DROP TRIGGER daily_transactions_delete;
DROP TRIGGER stats_transactions_insert;
DROP TRIGGER stats_transactions_delete;
DROP INDEX idx_transactions_missing_bitcoin_fee;

ALTER TABLE transactions DROP COLUMN fee;
ALTER TABLE transactions RENAME COLUMN bitcoin_fee TO fee;

CREATE INDEX idx_transactions_missing_fee ON transactions(tx_index DESC) WHERE fee IS NULL;

CREATE TRIGGER daily_transactions_insert AFTER INSERT ON transactions WHEN NEW.block_time > 0
AND NEW.fee IS NOT NULL BEGIN
INSERT INTO daily_metrics(day,btc_fees) VALUES(NEW.block_time/86400,CAST(NEW.fee AS REAL)/100000000.0)
ON CONFLICT(day) DO UPDATE SET btc_fees=coalesce(btc_fees,0)+excluded.btc_fees;
END;

CREATE TRIGGER daily_transactions_delete AFTER DELETE ON transactions WHEN OLD.block_time > 0
AND OLD.fee IS NOT NULL BEGIN
UPDATE daily_metrics SET btc_fees=nullif(btc_fees-CAST(OLD.fee AS REAL)/100000000.0,0)
WHERE day=OLD.block_time/86400;
END;

CREATE TRIGGER daily_transactions_fee_update AFTER UPDATE OF fee ON transactions
WHEN NEW.block_time > 0 AND OLD.fee IS NOT NEW.fee BEGIN
INSERT INTO daily_metrics(day,btc_fees)
VALUES(NEW.block_time/86400,(coalesce(CAST(NEW.fee AS REAL),0)-coalesce(CAST(OLD.fee AS REAL),0))/100000000.0)
ON CONFLICT(day) DO UPDATE SET btc_fees=coalesce(btc_fees,0)+excluded.btc_fees;
END;

CREATE TRIGGER stats_transactions_insert AFTER INSERT ON transactions BEGIN
UPDATE network_stats_snapshot SET
  transactions=transactions+1,
  btc_fees=btc_fees+coalesce(CAST(NEW.fee AS REAL),0)/100000000.0,
  updated_at=unixepoch()
WHERE singleton=1;
END;

CREATE TRIGGER stats_transactions_delete AFTER DELETE ON transactions BEGIN
UPDATE network_stats_snapshot SET
  transactions=max(0,transactions-1),
  btc_fees=btc_fees-coalesce(CAST(OLD.fee AS REAL),0)/100000000.0,
  updated_at=unixepoch()
WHERE singleton=1;
END;

CREATE TRIGGER stats_transactions_fee_update AFTER UPDATE OF fee ON transactions
WHEN OLD.fee IS NOT NEW.fee BEGIN
UPDATE network_stats_snapshot SET
  btc_fees=btc_fees+(coalesce(CAST(NEW.fee AS REAL),0)-coalesce(CAST(OLD.fee AS REAL),0))/100000000.0,
  updated_at=unixepoch()
WHERE singleton=1;
END;

UPDATE network_stats_snapshot SET
  btc_fees=(SELECT coalesce(sum(CAST(fee AS REAL)),0)/100000000.0 FROM transactions),
  updated_at=unixepoch()
WHERE singleton=1;

UPDATE daily_metrics SET btc_fees=NULL;
INSERT INTO daily_metrics(day,btc_fees)
SELECT block_time/86400,sum(CAST(fee AS REAL))/100000000.0
FROM transactions WHERE block_time>0 AND fee IS NOT NULL GROUP BY block_time/86400
ON CONFLICT(day) DO UPDATE SET btc_fees=excluded.btc_fees;

INSERT INTO core_state(key,value) VALUES('address_signals_cursor','0')
ON CONFLICT(key) DO UPDATE SET value='0';
