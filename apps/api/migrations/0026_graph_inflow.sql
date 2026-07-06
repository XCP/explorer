-- Scratch accumulator for the chunked power-iteration pass (D1 per-op CPU limit fix): each pass
-- accumulates degree-normalized inflow here in edge-rowid chunks, then applies it to graph_rank.
CREATE TABLE IF NOT EXISTS graph_inflow (
  node TEXT PRIMARY KEY,
  v    REAL NOT NULL
);
