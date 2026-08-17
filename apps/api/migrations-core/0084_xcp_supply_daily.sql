-- Daily XCP circulating supply, materialised.
--
-- RECONSTRUCTED 2026-08-17. This migration was recorded as applied in
-- production's d1_migrations but the file was missing from the repo, so the
-- table existed on the live database and nothing in the tree described it or
-- referenced it. Rebuilt here from the deployed schema so a fresh checkout
-- produces the same database. It will not re-run on production, which already
-- has the row; the guards make it safe if it does.
--
-- WHY IT EXISTS. XCP only ever mints via burns and destroys via fees and
-- destructions, and every such change is a one-sided row in the 1:1
-- credit/debit capture -- so the running credit-minus-debit sum IS the daily
-- supply curve. Validated against balances (the difference is open-order
-- escrow).
--
-- Deriving it costs a window function over the whole of ledger_events joined
-- to blocks: 3,313,631 rows read per call, measured on production. That ran on
-- every cache miss of /v2/price and came to 271,717,710 rows/day -- 11% of the
-- entire account's D1 reads -- to produce ~4,600 rows that change once a day.
--
-- The seed is the same aggregate the read path used to run, so this cannot
-- disagree with what it replaces. Recompute-and-store, never a running
-- counter: incremental arithmetic on a supply figure drifts, and the drift is
-- undetectable without recomputing anyway. See indexer/xcp-supply.ts for the
-- refresh that keeps it current.
CREATE TABLE IF NOT EXISTS xcp_supply_daily (
  day TEXT PRIMARY KEY,
  supply REAL NOT NULL
) WITHOUT ROWID;

INSERT OR IGNORE INTO xcp_supply_daily (day, supply)
SELECT day, SUM(delta) OVER (ORDER BY day) / 1e8 AS supply
  FROM (
    SELECT date(block.block_time, 'unixepoch') day,
           SUM(CASE WHEN ledger.direction = 1 THEN CAST(ledger.quantity AS REAL)
                    ELSE -CAST(ledger.quantity AS REAL) END) delta
      FROM ledger_events ledger
      JOIN blocks block ON block.block_index = ledger.block_index
     WHERE ledger.asset_id = (SELECT asset_id FROM asset_dictionary WHERE asset = 'XCP')
     GROUP BY day
  )
 ORDER BY day;
