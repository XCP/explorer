-- Daily materialized pricing health keeps the admin status endpoint off the full trade ledger.
CREATE TABLE pricing_health (
  currency TEXT PRIMARY KEY,
  trades INTEGER NOT NULL,
  missing INTEGER NOT NULL,
  divergent INTEGER NOT NULL,
  latest_price_day TEXT,
  latest_price_source TEXT,
  latest_observed_day TEXT,
  generated_at INTEGER NOT NULL
);
