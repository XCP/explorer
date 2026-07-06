-- Graph-reputation trait (Phase C, 2026-07-06). A STANDALONE Min-k-PPR TrustRank + reverse-graph
-- Anti-TrustRank scorer over the money-flow graph. See docs/graph-reputation.md for the literature basis.
-- NOT a reputation/config.ts factor — it is served on its own (trusted / distrusted / unscored TIERS, never a
-- 0-100 continuum), computed by the admin-driven bounded job buildGraphTrust (src/indexer/graph.ts).
--
-- Two result columns per entity. Assets score via their issuer + holder edges (bipartite reach); addresses
-- score via the send/trade/dispense money graph. graph_trust = component-wise MIN over k=3 seed-subset PPR
-- vectors (an attacker must be near ALL subsets, not one); graph_distrust = a single reverse-graph PPR run
-- from the curated scam seeds. Tier is derived at read time from the (trust, distrust) pair.
--
-- One ALTER per statement (SQLite requirement). Applied against the existing prod DB where the signals tables
-- already exist (same pattern as 0015-0023).
ALTER TABLE address_signals ADD COLUMN graph_trust REAL DEFAULT 0;
ALTER TABLE address_signals ADD COLUMN graph_distrust REAL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN graph_trust REAL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN graph_distrust REAL DEFAULT 0;

-- Partial indexes for the /v2/reputation/graph leaderboards (top-20 by trust / distrust). Partial so the
-- index only carries the reached minority — the vast majority of rows are 0 (unreached = unscored).
CREATE INDEX IF NOT EXISTS idx_adr_gtrust ON address_signals(graph_trust) WHERE graph_trust > 0;
CREATE INDEX IF NOT EXISTS idx_adr_gdistrust ON address_signals(graph_distrust) WHERE graph_distrust > 0;
CREATE INDEX IF NOT EXISTS idx_as_gtrust ON asset_signals(graph_trust) WHERE graph_trust > 0;
CREATE INDEX IF NOT EXISTS idx_as_gdistrust ON asset_signals(graph_distrust) WHERE graph_distrust > 0;

-- ----- Working / aux tables (rebuildable, Layer-2 derived; the job DELETEs + repopulates them each run) -----
-- graph_edges: the directed money-flow + bipartite graph. Multiple rows per (src,dst) are allowed (one per
-- source relation); the power-iteration SUM() adds them, so no cross-source dedupe is needed. Asset nodes are
-- namespaced 'asset:'||asset so they never collide with a bitcoin address in the shared node id space.
-- Weight = ln(1+count) per pair (address↔address relations) or a constant for the bipartite holder/issuer edges.
CREATE TABLE IF NOT EXISTS graph_edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  w   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gedge_src ON graph_edges(src);
CREATE INDEX IF NOT EXISTS idx_gedge_dst ON graph_edges(dst);

-- graph_node: per-node degree sums used for ACL-style degree normalization. outsum = Σ w of edges leaving the
-- node (forward normalizer); insum = Σ w of edges entering it (reverse-graph normalizer for Anti-TrustRank).
CREATE TABLE IF NOT EXISTS graph_node (
  id     TEXT PRIMARY KEY,
  outsum REAL DEFAULT 0,
  insum  REAL DEFAULT 0
);

-- graph_rank: the power-iteration state. One row per (node, slot). slots 0/1/2 = the three trust seed subsets
-- (forward PPR); slot 3 = the distrust reverse-graph PPR. s = teleport (seed) mass for that node in that slot
-- (Σ s = 1 within a slot); r = current rank; rn = next-iteration scratch.
CREATE TABLE IF NOT EXISTS graph_rank (
  node TEXT NOT NULL,
  slot INTEGER NOT NULL,
  s    REAL DEFAULT 0,
  r    REAL DEFAULT 0,
  rn   REAL DEFAULT 0,
  PRIMARY KEY (node, slot)
);

-- graph_seed: staging for the computed teleport vectors (node, slot, s), inserted by the job, then joined into
-- graph_rank in one UPDATE. Kept as its own table so the seed derivation (k-split hash, issuer/holder expansion)
-- happens in TS and lands as plain rows.
CREATE TABLE IF NOT EXISTS graph_seed (
  node TEXT NOT NULL,
  slot INTEGER NOT NULL,
  s    REAL NOT NULL,
  PRIMARY KEY (node, slot)
);
