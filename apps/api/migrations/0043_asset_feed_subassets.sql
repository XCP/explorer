-- The remaining live subasset-prefix count scanned the full ~254k assets table on every asset detail.
-- Materialize the exact top-level-parent count alongside the other earned-tab counts.
ALTER TABLE asset_feed_counts ADD COLUMN subassets INTEGER NOT NULL DEFAULT 0;
