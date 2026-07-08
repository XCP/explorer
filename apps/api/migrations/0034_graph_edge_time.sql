-- Temporal trust (Phase D, Option 1): stamp each money-flow edge with its most-recent interaction block so
-- the graph can RECENCY-DECAY edge weights. 75% of the trusted cohort is dormant (>1yr inactive) — a flat PPR
-- rewards stale position equally with current standing, which is the aged-address attack surface. Decayed
-- weights let old, cold vouches fade toward the floor so trust flows old→new. edge_block = MAX(block_index)
-- of the (src,dst) interactions; NULL for the structural bipartite issuer/holder edges (they don't decay).
ALTER TABLE graph_edges ADD COLUMN edge_block INTEGER;
