-- Circulating-scarcity factor (2026-06-28): asset_signals needs the asset's normalized supply at score time so
-- the scorer can compute CIRCULATING supply = supply_normalized × (100 − burned_pct)/100 and apply the
-- __circulating_scarcity term (3.5 − log10(circulating)). Circulating (not issued) is the right scarcity base:
-- NINJASUIT issued 21M but burned ~100% → circulating ~198, correctly scarce; the raw-issued penalty wrongly
-- flagged it. Populated by the asset_seed feature unit from assets.supply_normalized; needs a signals refresh.
ALTER TABLE asset_signals ADD COLUMN supply REAL DEFAULT 0;
