-- Counterparty records the controlling address separately when a send endpoint is a UTXO.
CREATE INDEX idx_sends_source_address ON sends(source_address_id, block_index DESC, event_index DESC)
WHERE source_address_id IS NOT NULL;

CREATE INDEX idx_sends_destination_address ON sends(destination_address_id, block_index DESC, event_index DESC)
WHERE destination_address_id IS NOT NULL;
