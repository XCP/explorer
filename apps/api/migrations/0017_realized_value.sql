-- Realized VALUE signals (2026-06-28 lab): the model measured volume, never worth. A grail commands a high
-- price even at tiny volume (WINKELPEPE 3 trades, PEPEALASSAD traded at 6482 XCP/unit). These capture the
-- biggest REALIZED transaction value (actual dispense/trade, not the aspirational dispenser ask). Permanent —
-- realized value is lasting proof of grail-ness, so (unlike activity) it does NOT decay.
ALTER TABLE asset_signals ADD COLUMN max_dispense_btc REAL DEFAULT 0;  -- largest BTC actually paid in a dispense
ALTER TABLE asset_signals ADD COLUMN max_trade_xcp REAL DEFAULT 0;     -- largest XCP that changed hands in a DEX match
