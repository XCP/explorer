CREATE INDEX idx_transaction_outputs_block
  ON transaction_outputs(block_index, tx_index, out_index);

DELETE FROM core_state WHERE key='trades_cur_dispense';
