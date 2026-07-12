-- No production read filters the provenance ledger by asset. Avoid maintaining
-- a seven-million-row speculative index; add a purpose-built index if that API appears.
DROP INDEX idx_ledger_asset_address;
