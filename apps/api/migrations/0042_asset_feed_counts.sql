-- Materialized counts for the asset detail page's earned tabs. D1 Insights (7d, 2026-07-12)
-- measured the former twelve-scalar read at 10,601 runs / 2.8bn rows read. These columns are
-- rebuildable from mirror/derived source tables by the signals full + dirty-asset cascade.
CREATE TABLE IF NOT EXISTS asset_feed_counts (
  asset TEXT PRIMARY KEY,
  sales INTEGER NOT NULL DEFAULT 0,
  issuances INTEGER NOT NULL DEFAULT 0,
  dispensers INTEGER NOT NULL DEFAULT 0,
  dispenses INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 0,
  fairmints INTEGER NOT NULL DEFAULT 0,
  dividends INTEGER NOT NULL DEFAULT 0,
  destructions INTEGER NOT NULL DEFAULT 0,
  pools INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
