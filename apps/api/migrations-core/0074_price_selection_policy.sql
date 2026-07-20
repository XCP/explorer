-- Make the selected daily price projection explainable without changing its historical winners.
ALTER TABLE prices ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'legacy-fidelity';
ALTER TABLE prices ADD COLUMN price_kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE prices ADD COLUMN age_days INTEGER CHECK(age_days IS NULL OR age_days>=0);
ALTER TABLE prices ADD COLUMN derivation_depth INTEGER CHECK(derivation_depth IS NULL OR derivation_depth>=0);
ALTER TABLE prices ADD COLUMN observation_count INTEGER CHECK(observation_count IS NULL OR observation_count>=0);
ALTER TABLE prices ADD COLUMN venue_count INTEGER CHECK(venue_count IS NULL OR venue_count>=0);
ALTER TABLE prices ADD COLUMN volume_base REAL CHECK(volume_base IS NULL OR volume_base>=0);
ALTER TABLE prices ADD COLUMN disagreement_class TEXT;
ALTER TABLE prices ADD COLUMN selection_reason TEXT;

UPDATE prices SET
  policy_version='usd-payment-v1',
  price_kind=CASE WHEN source IN ('burn_vwm','dex_vwm','dextrade_xcpbtc_spot') THEN 'derived' ELSE 'direct' END,
  age_days=CAST(julianday(day)-julianday(observed_day) AS INTEGER),
  derivation_depth=CASE WHEN source IN ('burn_vwm','dex_vwm','dextrade_xcpbtc_spot') THEN 1 ELSE 0 END,
  observation_count=CASE WHEN source IN ('coinbase','coinbase_spot','dextrade_xcpbtc_spot') THEN 1 END,
  venue_count=1,
  disagreement_class='not_evaluated',
  selection_reason='migration_backfill';

CREATE TABLE price_selection_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  currency TEXT NOT NULL,
  changed_at INTEGER NOT NULL DEFAULT(unixepoch()),
  policy_version TEXT NOT NULL,
  old_usd REAL NOT NULL,
  new_usd REAL NOT NULL,
  old_source TEXT NOT NULL,
  new_source TEXT NOT NULL,
  old_observed_day TEXT,
  new_observed_day TEXT,
  reason TEXT NOT NULL
);
CREATE INDEX idx_price_selection_changes_day ON price_selection_changes(currency,day,changed_at DESC);

CREATE TRIGGER log_price_selection_change AFTER UPDATE ON prices
WHEN OLD.usd IS NOT NEW.usd OR OLD.source IS NOT NEW.source OR OLD.observed_day IS NOT NEW.observed_day
BEGIN
  INSERT INTO price_selection_changes(
    day,currency,policy_version,old_usd,new_usd,old_source,new_source,old_observed_day,new_observed_day,reason
  ) VALUES(
    NEW.day,NEW.currency,NEW.policy_version,OLD.usd,NEW.usd,OLD.source,NEW.source,
    OLD.observed_day,NEW.observed_day,COALESCE(NEW.selection_reason,'unspecified')
  );
END;
