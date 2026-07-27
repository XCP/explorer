-- Likely bilateral OTC sales reconstructed from a direct BTC payment between the
-- recipient and sender of a Counterparty asset. The corresponding canonical row
-- lives in trades(venue='otc'); this relation preserves why that row was admitted.
CREATE TABLE otc_trade_evidence (
  ref TEXT PRIMARY KEY,
  asset_event_index INTEGER NOT NULL,
  asset_tx_hash BLOB NOT NULL,
  btc_tx_hash TEXT NOT NULL,
  btc_payment_block INTEGER NOT NULL,
  asset_delivery_block INTEGER NOT NULL,
  relative_blocks INTEGER NOT NULL,
  payment_sats INTEGER NOT NULL CHECK(payment_sats>0),
  payer_input_count INTEGER NOT NULL,
  payee_output_count INTEGER NOT NULL,
  attribution_flags INTEGER NOT NULL,
  competing_payments INTEGER NOT NULL DEFAULT 0,
  competing_deliveries INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL CHECK(confidence IN ('likely','corroborated')),
  method TEXT NOT NULL DEFAULT 'direct_btc_for_counterparty_asset',
  method_version INTEGER NOT NULL,
  indexed_through_block INTEGER NOT NULL,
  evidence_note TEXT,
  reviewed_at INTEGER,
  UNIQUE(asset_event_index,btc_tx_hash)
) WITHOUT ROWID;

CREATE INDEX idx_otc_trade_evidence_btc_tx
ON otc_trade_evidence(btc_tx_hash);

CREATE INDEX idx_otc_trade_evidence_delivery
ON otc_trade_evidence(asset_delivery_block,asset_event_index);
