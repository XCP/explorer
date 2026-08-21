-- The per-asset orders tab reads newest-first pages, but the per-side indexes carried only
-- (asset_id, status), so each side of the lookup sorted every one of the asset's orders on every
-- call — 394k rows for PEPECASH, 566k for the OR-shape it replaced. With block ordering inside the
-- asset prefix, each side becomes a seek that stops at offset+limit rows. Orders grow by ~120
-- rows/day, so the two extra indexes cost almost nothing to maintain.
CREATE INDEX idx_orders_give_block ON orders (give_asset_id, block_index DESC, tx_index DESC);

CREATE INDEX idx_orders_get_block ON orders (get_asset_id, block_index DESC, tx_index DESC);
