-- Chunked edge accumulation (D1 storage-op timeout fix) upserts on (src,dst) — it needs a unique
-- conflict target. Clear any partial build first (aux/derived data; the job rebuilds from scratch).
DELETE FROM graph_edges;
DROP INDEX IF EXISTS idx_gedge_src;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gedge_pair ON graph_edges(src, dst);
