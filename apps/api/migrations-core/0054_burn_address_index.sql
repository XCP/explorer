-- Burn addresses are a tiny subset of the address population. Asset accounting
-- should seek their balances rather than scan every holder to identify burns.
CREATE INDEX idx_address_signals_burns
ON address_signals(address_id)
WHERE is_burn=1;
