DROP INDEX idx_ledger_address_page;
CREATE INDEX idx_ledger_address_page
  ON ledger_events(address_id, block_index DESC, tx_hash, event_index);
