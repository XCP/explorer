CREATE TRIGGER daily_counterparty_blocks_update AFTER UPDATE OF transaction_count ON blocks
WHEN NEW.block_time > 0 AND NEW.transaction_count IS NOT OLD.transaction_count BEGIN
  INSERT INTO daily_metrics(day,transactions)
  VALUES(NEW.block_time/86400,coalesce(NEW.transaction_count,0)-coalesce(OLD.transaction_count,0))
  ON CONFLICT(day) DO UPDATE SET
    transactions=coalesce(transactions,0)+excluded.transactions;
END;
