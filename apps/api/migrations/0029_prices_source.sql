-- Provenance on the USD price calendar. Each price day now records HOW it was made — categorical,
-- not an ordinal grade (see research-backlog §C: source, not "fidelity level"). Existing rows are
-- 'derived' (own-DEX VWAP × Coinbase anchor / Coinbase direct). External imports (CoinMarketCap-era
-- XCP history from the legacy app) land as 'legacy-cmc' and win on the days they cover.
ALTER TABLE prices ADD COLUMN source TEXT NOT NULL DEFAULT 'derived';
