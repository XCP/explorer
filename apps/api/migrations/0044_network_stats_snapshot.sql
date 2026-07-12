-- Rebuildable exact network counts and lifetime totals for cheap overview reads.
CREATE TABLE network_stats_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  assets INTEGER NOT NULL DEFAULT 0, transactions INTEGER NOT NULL DEFAULT 0,
  balances INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0,
  issuances INTEGER NOT NULL DEFAULT 0, dispensers INTEGER NOT NULL DEFAULT 0,
  dispenses INTEGER NOT NULL DEFAULT 0, orders INTEGER NOT NULL DEFAULT 0,
  order_matches INTEGER NOT NULL DEFAULT 0, sweeps INTEGER NOT NULL DEFAULT 0,
  broadcasts INTEGER NOT NULL DEFAULT 0, dividends INTEGER NOT NULL DEFAULT 0,
  fairmints INTEGER NOT NULL DEFAULT 0, destructions INTEGER NOT NULL DEFAULT 0,
  holders INTEGER NOT NULL DEFAULT 0, btc_fees REAL NOT NULL DEFAULT 0,
  xcp_destroyed REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO network_stats_snapshot (singleton) VALUES (1);
