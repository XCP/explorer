-- Existing edges are the published baseline. A revision makes changed pairs visible together.
ALTER TABLE graph_edges ADD COLUMN revision INTEGER;
ALTER TABLE graph_edges ADD COLUMN next_weight REAL;
ALTER TABLE graph_edges ADD COLUMN next_edge_block INTEGER;

CREATE VIEW published_graph_edges AS
SELECT generation,source_entity_id,destination_entity_id,
  CASE WHEN revision<=published THEN next_weight ELSE weight END AS weight,
  CASE WHEN revision<=published THEN next_edge_block ELSE edge_block END AS edge_block
FROM graph_edges
CROSS JOIN (SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_edge_revision'),0) AS published)
WHERE CASE WHEN revision<=published THEN next_weight ELSE weight END>0;

INSERT INTO core_state(key,value) VALUES('graph_differential_enabled','1');
