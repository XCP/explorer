-- Keep source classification separate from canonical Bitcoin spent-state checks.
ALTER TABLE recovery_outputs ADD COLUMN chain_checked_at INTEGER;

CREATE INDEX recovery_outputs_chain_check
  ON recovery_outputs(chain_checked_at, txid, vout);

INSERT INTO recovery_state (key, value, updated_at)
VALUES ('read_ready', '0', unixepoch())
ON CONFLICT(key) DO NOTHING;
