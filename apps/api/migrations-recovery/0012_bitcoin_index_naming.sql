-- The hosted Bitcoin tables are simply the Bitcoin index; retire the "sidecar" branding.
-- Domain language names things — these are coverage state, address balances, and Counterparty fees.
ALTER TABLE btc_sidecar_state RENAME TO btc_index_state;
ALTER TABLE btc_sidecar_address_balance RENAME TO btc_address_balance;
ALTER TABLE btc_sidecar_fee RENAME TO btc_counterparty_tx_fee;
DROP INDEX IF EXISTS btc_sidecar_address_balance_amount;
CREATE INDEX IF NOT EXISTS btc_address_balance_amount ON btc_address_balance(balance_sats DESC, address);
