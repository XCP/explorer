-- The graph score pass now runs in Worker memory (src/indexer/graph.ts): the SQL power iteration billed
-- ~200M D1 row writes per rebuild against graph_rank/graph_inflow. Those working tables and graph_node
-- (degree sums, now computed in memory) are retired. graph_edges stays — holder-cohesion and the
-- graph-extract reads serve it — but sheds the accumulated stale generations and the source index that
-- exactly duplicated the WITHOUT ROWID primary key (every insert paid it for nothing).
DROP TABLE graph_rank;

DROP TABLE graph_node;

DROP TABLE graph_inflow;

DELETE FROM graph_seed
WHERE
  generation <> (
    SELECT
      CAST(value AS INTEGER)
    FROM
      core_state
    WHERE
      KEY = 'graph_generation'
  );

CREATE TABLE graph_edges_active (
  generation INTEGER NOT NULL,
  source_entity_id INTEGER NOT NULL,
  destination_entity_id INTEGER NOT NULL,
  weight REAL NOT NULL,
  edge_block INTEGER,
  PRIMARY KEY (generation, source_entity_id, destination_entity_id)
) WITHOUT ROWID;

-- Windowed copy of the active generation only (bounded statements; ids currently top out ~1.07M).
INSERT INTO
  graph_edges_active
SELECT
  *
FROM
  graph_edges
WHERE
  generation = (
    SELECT
      CAST(value AS INTEGER)
    FROM
      core_state
    WHERE
      KEY = 'graph_generation'
  )
  AND source_entity_id <= 300000;

INSERT INTO
  graph_edges_active
SELECT
  *
FROM
  graph_edges
WHERE
  generation = (
    SELECT
      CAST(value AS INTEGER)
    FROM
      core_state
    WHERE
      KEY = 'graph_generation'
  )
  AND source_entity_id > 300000
  AND source_entity_id <= 600000;

INSERT INTO
  graph_edges_active
SELECT
  *
FROM
  graph_edges
WHERE
  generation = (
    SELECT
      CAST(value AS INTEGER)
    FROM
      core_state
    WHERE
      KEY = 'graph_generation'
  )
  AND source_entity_id > 600000
  AND source_entity_id <= 900000;

INSERT INTO
  graph_edges_active
SELECT
  *
FROM
  graph_edges
WHERE
  generation = (
    SELECT
      CAST(value AS INTEGER)
    FROM
      core_state
    WHERE
      KEY = 'graph_generation'
  )
  AND source_entity_id > 900000;

DROP TABLE graph_edges;

ALTER TABLE graph_edges_active
RENAME TO graph_edges;

CREATE INDEX idx_graph_edges_destination ON graph_edges (generation, destination_entity_id, source_entity_id);
