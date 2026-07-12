-- Let burn-derived maintenance start from the tiny burn-address set, not the 1.77M-row sends table.
CREATE INDEX idx_adr_burn ON address_signals(address) WHERE is_burn=1;
