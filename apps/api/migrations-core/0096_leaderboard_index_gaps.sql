-- Close the two gaps in the address leaderboard index set.
--
-- /stats fires its boards in one Promise.all, so every board runs the same
-- number of times. Most already have a partial index in the established shape
-- — (col DESC, address_id) WHERE col > 0 — for survived_assets, assets_held,
-- clean_btc_spent, stamps_created, stamps_collected and src20_deploys. Two
-- were never given one, and they are the only address boards that still show
-- up in d1 insights:
--
--   ORDER BY clean_dispense_btc DESC   61,829,688 rows read / 132 runs / 468,406 each
--   ORDER BY assets_hits DESC          46,197,704 rows read / 104 runs / 444,208 each
--
-- 108M rows read a week to return twelve rows apiece. Both plans were
--
--   SCAN signal
--   USE TEMP B-TREE FOR ORDER BY
--
-- which is the same failure 0085 described: no index could serve the filter or
-- the ordering, so the whole 442,493-row table went through a sort to find
-- twelve. The boards that already have their index do not appear in insights
-- at all, which is the clearest evidence that this shape works.
--
-- Selectivity, measured before choosing partial over full:
--
--   address_signals              442,493 rows
--   clean_dispense_btc > 0        13,023 rows   (2.9%)
--   assets_hits > 0                  920 rows   (0.2%)
--
-- Partial rather than full matters here for write cost, not read cost.
-- address_signals already carries twelve indexes and is rewritten by the
-- weekly full-population repair; a full index would add 442,493 entries to
-- that. These add 13,023 and 920. Per rule 9, every index multiplies inserts,
-- so the predicate is what keeps this close to free — a write only touches
-- these indexes when a row crosses the zero boundary.
--
-- Unlike 0085, the filter column and the ORDER BY column are the same here, so
-- the descending walk both satisfies the ordering and stops at the first row
-- that fails the predicate. That is also why these need no INDEXED BY hint:
-- verified against a local reproduction of this schema, index set and row
-- distribution, SQLite picks both unaided and reports
-- SEARCH ... USING COVERING INDEX with no temp b-tree.
--
-- The trailing address_id matches the newer siblings and makes the walk order
-- total, so ties come back in a stable order rather than in whatever sequence
-- the scan produced.
CREATE INDEX IF NOT EXISTS idx_address_signals_clean_dispense
  ON address_signals(clean_dispense_btc DESC, address_id)
  WHERE clean_dispense_btc > 0;

CREATE INDEX IF NOT EXISTS idx_address_signals_assets_hits
  ON address_signals(assets_hits DESC, address_id)
  WHERE assets_hits > 0;
