ALTER TABLE prices ADD COLUMN observed_day TEXT;
ALTER TABLE prices ADD COLUMN fidelity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE xcp_btc_daily ADD COLUMN volume_xcp TEXT;
ALTER TABLE xcp_btc_daily ADD COLUMN trades INTEGER NOT NULL DEFAULT 0;

UPDATE prices SET observed_day=day,fidelity=3 WHERE source='coinbase';
DELETE FROM prices WHERE currency='XCP' AND source='derived';
