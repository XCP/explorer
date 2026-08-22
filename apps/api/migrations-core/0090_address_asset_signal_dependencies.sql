-- Coalesce address-derived asset repairs across a complete address queue or repair cycle. Reusing
-- asset_signal_dirty directly let the asset worker drain and reinsert popular assets between address
-- batches, creating repeated writes for the same dependency.
CREATE TABLE asset_signal_dependency_dirty (
  asset_id INTEGER PRIMARY KEY
) WITHOUT ROWID;
