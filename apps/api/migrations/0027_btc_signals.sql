-- Bitcoin-side address summaries (the Counterparty mirror is blind to plain BTC activity).
-- Populated by ops/export-btc-stats.mjs from a local Core+Fulcrum node (bulk) or a public
-- Esplora API (incremental) via POST /admin/btc-stats. Own table: different lifecycle and
-- provenance than the Counterparty-derived address_signals.
CREATE TABLE IF NOT EXISTS btc_signals (
  addr          TEXT PRIMARY KEY,
  btc_received  REAL DEFAULT 0,    -- lifetime BTC received (all Bitcoin txs, not just Counterparty)
  btc_sent      REAL DEFAULT 0,
  btc_balance   REAL DEFAULT 0,
  btc_txs       INTEGER DEFAULT 0, -- lifetime Bitcoin tx count
  btc_first_blk INTEGER,           -- first Bitcoin activity (block height)
  btc_last_blk  INTEGER,           -- most recent Bitcoin activity
  updated_at    INTEGER            -- unix seconds of the ingest that wrote this row
);
