DROP TABLE graph_inflow;

DROP TABLE graph_seed;

DROP TABLE graph_rank;

DROP TABLE graph_node;

DROP TABLE graph_edges;

CREATE TABLE graph_edges (
  generation INTEGER NOT NULL,
  source_entity_id INTEGER NOT NULL,
  destination_entity_id INTEGER NOT NULL,
  weight REAL NOT NULL,
  edge_block INTEGER,
  PRIMARY KEY (generation, source_entity_id, destination_entity_id)
) WITHOUT ROWID;

CREATE INDEX idx_graph_edges_source ON graph_edges (generation, source_entity_id, destination_entity_id);

CREATE INDEX idx_graph_edges_destination ON graph_edges (generation, destination_entity_id, source_entity_id);

CREATE TABLE graph_node (
  generation INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  outsum REAL NOT NULL DEFAULT 0,
  insum REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (generation, entity_id)
) WITHOUT ROWID;

CREATE TABLE graph_rank (
  generation INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  rank REAL NOT NULL DEFAULT 0,
  normalized_rank REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (generation, entity_id, slot)
) WITHOUT ROWID;

CREATE TABLE graph_seed (
  generation INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (generation, entity_id, slot)
) WITHOUT ROWID;

CREATE TABLE graph_inflow (generation INTEGER NOT NULL, entity_id INTEGER NOT NULL, value REAL NOT NULL, PRIMARY KEY (generation, entity_id)) WITHOUT ROWID;

INSERT INTO
  core_state (KEY, value)
VALUES
  ('graph_generation', '0')
ON CONFLICT (KEY) DO NOTHING;
