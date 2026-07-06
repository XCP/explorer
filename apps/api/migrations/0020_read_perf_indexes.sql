-- Read-path performance indexes. APPLY AFTER the full reindex completes (index builds compete with the
-- replay's heavy writes, and the reason we're indexing now is a write-capacity incident — so defer).
-- Apply: npx wrangler d1 migrations apply xcpio --remote   (then ANALYZE; see docs/query-perf.md)
--
-- Evidence-based (EXPLAIN QUERY PLAN on live data). The firsts full-scans were fixed in code (the MIN-narrow
-- rewrite in src/read/firsts.ts uses the existing single-column block_index indexes), so the ONLY remaining
-- firsts scan is over `assets` filtered by `type` — which has no supporting index. assets is ~252k rows and
-- the subasset/numeric firsts compute MIN(first_issuance_block_index) WHERE type=... = a full scan each.
-- This composite turns those into an index seek (first row in type order = the earliest).
CREATE INDEX IF NOT EXISTS idx_assets_type_fib ON assets(type, first_issuance_block_index);
