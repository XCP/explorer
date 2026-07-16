-- Exact O(1) progress for the finite historical dirty-identity seed and its
-- steady-state event queue. Generic table triggers cover every enqueue source.
INSERT OR REPLACE INTO core_state(key,value)
SELECT 'emblem_trade_dirty_remaining',CAST(COUNT(*) AS TEXT) FROM emblem_trade_dirty;

CREATE TRIGGER emblem_trade_dirty_progress_insert AFTER INSERT ON emblem_trade_dirty BEGIN
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)
  WHERE key='emblem_trade_dirty_remaining';
END;

CREATE TRIGGER emblem_trade_dirty_progress_delete AFTER DELETE ON emblem_trade_dirty BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-1) AS TEXT)
  WHERE key='emblem_trade_dirty_remaining';
END;
