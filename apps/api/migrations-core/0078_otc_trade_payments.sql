-- A reconstructed OTC trade can aggregate multiple direct BTC payments into one
-- asset delivery. Keep every payment leg so the canonical trade total remains
-- auditable without overloading otc_trade_evidence.btc_tx_hash.
CREATE TABLE otc_trade_payments (
  evidence_ref TEXT NOT NULL,
  btc_tx_hash TEXT NOT NULL,
  btc_payment_block INTEGER NOT NULL,
  btc_payment_time INTEGER NOT NULL,
  payment_sats INTEGER NOT NULL CHECK (payment_sats > 0),
  PRIMARY KEY (evidence_ref, btc_tx_hash),
  FOREIGN KEY (evidence_ref) REFERENCES otc_trade_evidence (ref) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX idx_otc_trade_payments_tx ON otc_trade_payments (btc_tx_hash, evidence_ref);
