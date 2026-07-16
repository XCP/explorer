-- Keep operator progress O(1). D1 scans integer primary-key tables for aggregate
-- MIN/MAX, so durable totals are cheaper than deriving bounds on every status read.
INSERT OR REPLACE INTO core_state(key,value)
SELECT 'transactions_total',CAST(COUNT(*) AS TEXT) FROM transactions;

INSERT OR REPLACE INTO core_state(key,value)
SELECT 'blocks_total',CAST(COUNT(*) AS TEXT) FROM blocks;

CREATE TRIGGER transactions_total_insert AFTER INSERT ON transactions BEGIN
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)
  WHERE key='transactions_total';
END;

CREATE TRIGGER transactions_total_delete AFTER DELETE ON transactions BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-1) AS TEXT)
  WHERE key='transactions_total';
END;

CREATE TRIGGER blocks_total_insert AFTER INSERT ON blocks BEGIN
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)
  WHERE key='blocks_total';
END;

CREATE TRIGGER blocks_total_delete AFTER DELETE ON blocks BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-1) AS TEXT)
  WHERE key='blocks_total';
END;
