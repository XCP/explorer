ALTER TABLE blocks ADD COLUMN bitcoin_transaction_count INTEGER;
ALTER TABLE daily_metrics ADD COLUMN bitcoin_transactions INTEGER;

CREATE TRIGGER daily_bitcoin_blocks_insert AFTER INSERT ON blocks
WHEN NEW.block_time > 0 AND NEW.bitcoin_transaction_count IS NOT NULL BEGIN
  INSERT INTO daily_metrics(day,bitcoin_transactions)
  VALUES(NEW.block_time/86400,NEW.bitcoin_transaction_count)
  ON CONFLICT(day) DO UPDATE SET
    bitcoin_transactions=coalesce(bitcoin_transactions,0)+excluded.bitcoin_transactions;
END;

CREATE TRIGGER daily_bitcoin_blocks_update AFTER UPDATE OF bitcoin_transaction_count ON blocks
WHEN NEW.block_time > 0 AND NEW.bitcoin_transaction_count IS NOT OLD.bitcoin_transaction_count BEGIN
  INSERT INTO daily_metrics(day,bitcoin_transactions)
  VALUES(NEW.block_time/86400,coalesce(NEW.bitcoin_transaction_count,0)-coalesce(OLD.bitcoin_transaction_count,0))
  ON CONFLICT(day) DO UPDATE SET
    bitcoin_transactions=coalesce(bitcoin_transactions,0)+excluded.bitcoin_transactions;
END;

CREATE TRIGGER daily_bitcoin_blocks_delete AFTER DELETE ON blocks
WHEN OLD.block_time > 0 AND OLD.bitcoin_transaction_count IS NOT NULL BEGIN
  UPDATE daily_metrics SET bitcoin_transactions=nullif(bitcoin_transactions-OLD.bitcoin_transaction_count,0)
  WHERE day=OLD.block_time/86400;
END;
