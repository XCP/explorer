-- The trades feed counters tracked INSERT and DELETE but not re-attribution: several trade
-- builders upsert with `DO UPDATE SET asset_id=excluded.asset_id` (a dispense-payment trade
-- re-resolved to another lot member, a bundle re-classification), so every such move leaked a
-- phantom +1 on the old asset and left the new asset one short — "Trades 1 · No trades" pages.
-- Track the move, then reconcile every drifted counter against the trades table itself.

CREATE TRIGGER feed_trades_update_asset AFTER UPDATE OF asset_id ON trades
WHEN OLD.asset_id IS NOT NEW.asset_id BEGIN
  UPDATE asset_feed_counts SET sales = max(0, sales - 1), updated_at = unixepoch()
  WHERE asset_id = OLD.asset_id;
  INSERT INTO asset_feed_counts (asset_id, sales, updated_at)
  SELECT NEW.asset_id, 1, unixepoch() WHERE NEW.asset_id IS NOT NULL
  ON CONFLICT (asset_id) DO UPDATE SET
    sales = sales + 1,
    updated_at = excluded.updated_at;
END;

UPDATE asset_feed_counts
SET sales = (SELECT COUNT(*) FROM trades WHERE trades.asset_id = asset_feed_counts.asset_id),
    updated_at = unixepoch()
WHERE sales <> (SELECT COUNT(*) FROM trades WHERE trades.asset_id = asset_feed_counts.asset_id);
