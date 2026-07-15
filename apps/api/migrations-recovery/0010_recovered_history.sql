-- Historical gross value spent from indexed recovery outputs, bucketed by the
-- exact timestamp of the confirming Bitcoin block.
CREATE TABLE recovery_monthly_recovered (
  month INTEGER PRIMARY KEY,
  outputs INTEGER NOT NULL,
  spending_transactions INTEGER NOT NULL,
  gross_sats INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
