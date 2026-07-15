-- Durable forward-index cursor plus compact projections for the public recovery page.
-- The projections are rebuildable from recovery_outputs; recovery_outputs remains authoritative.
CREATE TABLE recovery_stats_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  recoverable_outputs INTEGER NOT NULL,
  recoverable_sats INTEGER NOT NULL,
  protected_stamp_outputs INTEGER NOT NULL,
  protected_stamp_sats INTEGER NOT NULL,
  unprotected_outputs INTEGER NOT NULL,
  unprotected_sats INTEGER NOT NULL,
  recovery_addresses INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE recovery_monthly_stats (
  month INTEGER PRIMARY KEY,
  unprotected_outputs INTEGER NOT NULL,
  unprotected_sats INTEGER NOT NULL,
  protected_stamp_outputs INTEGER NOT NULL,
  protected_stamp_sats INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE recovery_address_stats (
  address TEXT PRIMARY KEY,
  unprotected_outputs INTEGER NOT NULL,
  unprotected_sats INTEGER NOT NULL,
  protected_stamp_outputs INTEGER NOT NULL,
  protected_stamp_sats INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX recovery_address_stats_unprotected
  ON recovery_address_stats(unprotected_sats DESC, address);
