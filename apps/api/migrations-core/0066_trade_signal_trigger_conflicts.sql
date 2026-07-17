-- A parent INSERT ... ON CONFLICT can override legacy INSERT OR IGNORE behavior
-- inside SQLite triggers. Use a targeted conflict action so one multi-row trade
-- projection can enqueue the same asset repeatedly without aborting.
DROP TRIGGER asset_signal_dirty_trade_insert;
DROP TRIGGER asset_signal_dirty_trade_update;
DROP TRIGGER asset_signal_dirty_trade_delete;

CREATE TRIGGER asset_signal_dirty_trade_insert AFTER INSERT ON trades
WHEN NEW.asset_id IS NOT NULL BEGIN
  INSERT INTO asset_signal_dirty(asset_id) VALUES(NEW.asset_id)
  ON CONFLICT(asset_id) DO NOTHING;
END;

CREATE TRIGGER asset_signal_dirty_trade_update AFTER UPDATE ON trades
WHEN OLD.asset_id IS NOT NEW.asset_id OR OLD.block_time IS NOT NEW.block_time
  OR OLD.total IS NOT NEW.total OR OLD.usd_value IS NOT NEW.usd_value
  OR OLD.buyer_id IS NOT NEW.buyer_id OR OLD.seller_id IS NOT NEW.seller_id
  OR OLD.sale_class IS NOT NEW.sale_class BEGIN
  INSERT INTO asset_signal_dirty(asset_id) SELECT OLD.asset_id WHERE OLD.asset_id IS NOT NULL
  ON CONFLICT(asset_id) DO NOTHING;
  INSERT INTO asset_signal_dirty(asset_id) SELECT NEW.asset_id WHERE NEW.asset_id IS NOT NULL
  ON CONFLICT(asset_id) DO NOTHING;
END;

CREATE TRIGGER asset_signal_dirty_trade_delete AFTER DELETE ON trades
WHEN OLD.asset_id IS NOT NULL BEGIN
  INSERT INTO asset_signal_dirty(asset_id) VALUES(OLD.asset_id)
  ON CONFLICT(asset_id) DO NOTHING;
END;
