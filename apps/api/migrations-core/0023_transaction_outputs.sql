-- Preserve Bitcoin output identity for dispenser payments. One output can execute several
-- dispensers, so output identity is required to distinguish a sale from its asset legs.
CREATE TABLE transaction_outputs (
  tx_index INTEGER NOT NULL,
  out_index INTEGER NOT NULL,
  block_index INTEGER NOT NULL,
  destination_id INTEGER,
  btc_amount TEXT NOT NULL,
  PRIMARY KEY (tx_index, out_index)
);

CREATE INDEX idx_transaction_outputs_destination
  ON transaction_outputs(destination_id, block_index DESC, tx_index, out_index);

CREATE TABLE trade_legs (
  venue TEXT NOT NULL,
  trade_ref TEXT NOT NULL,
  leg_index INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  quantity REAL,
  PRIMARY KEY (venue, trade_ref, leg_index)
);

CREATE INDEX idx_trade_legs_asset ON trade_legs(asset_id, venue, trade_ref);
