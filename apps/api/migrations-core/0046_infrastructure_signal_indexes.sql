-- Infrastructure lists are tiny relative to the address population. Partial
-- indexes make exchange pages and summary counts proportional to those lists.
CREATE INDEX idx_address_signals_exchanges
ON address_signals(in_peers DESC,address_id)
WHERE is_exchange=1;

CREATE INDEX idx_address_signals_deposits
ON address_signals(address_id)
WHERE is_deposit=1;
