-- Serve the two signal leaderboards from an index instead of a full scan.
--
-- Both queries filter on a near-boolean flag, order by a score, and take a
-- page. Neither had an index that could do either job, so the planner scanned
-- the whole signal table and pushed every surviving row through a temp b-tree
-- to find the top 100:
--
--   EXPLAIN: SCAN signal
--            USE TEMP B-TREE FOR ORDER BY
--
-- Measured on production, rows_read for one call returning 100 rows:
--
--   src/queries/stats.ts        address_signals board   485,537 rows   180ms
--   src/queries/core-assets.ts  asset_signals board     296,849 rows   199ms
--
-- Together those ran 194 times in 24h for ~73.5M rows read.
--
-- Column order: unlike 0035's case in the exchange repo, here the filtered set
-- is much LARGER than the page, so the ORDER BY is the right thing to index.
-- Checked before choosing:
--
--   address_signals   442,239 rows, 21,649 match (disp_trust>0, is_exchange=0)
--   asset_signals     274,818 rows,  7,386 match (trades>0, low_quality=0)
--
-- 21,649 and 7,386 both far exceed the LIMIT of 100, so a LIMIT placed on the
-- sort column fills immediately and the walk stops. Leading with the equality
-- flag keeps the descending walk inside the matching partition.
--
-- The range predicate (`disp_trust>0`, `trades>0`) stays a per-row filter,
-- which costs nothing: the walk is descending and every row it touches before
-- filling the page is above the threshold anyway.
--
-- Measured after: 200 rows / 1.2ms and 300 rows / 1.5ms — 2,428x and 990x.
--
-- Size cost on a database that is at 4.19 GB of D1's 10 GB hard per-database
-- limit: ~12 MB for both, about 0.1% of the remaining headroom.
CREATE INDEX IF NOT EXISTS idx_address_signals_disp_trust
  ON address_signals(is_exchange, disp_trust DESC);

CREATE INDEX IF NOT EXISTS idx_asset_signals_trades
  ON asset_signals(low_quality, trades DESC);
