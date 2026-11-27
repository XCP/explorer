import { BIP_W, ENTITY_EXCLUDED, ENTITY_MAX } from "#api/indexer/graph-core";

// Partition by source so all contributions to one directed pair are counted together.
// Comparing to the staged revision also makes a retry or an explicit restart idempotent.
export function graphDiffSql(bipartite: boolean): string {
  const holdings = bipartite
    ? `
    UNION SELECT a.src,other.entity_id,${BIP_W},NULL FROM allowed a
      CROSS JOIN balances b ON b.address_id=a.id AND CAST(b.quantity AS INTEGER)>0
      JOIN asset_dictionary d ON d.asset_id=b.asset_id
      JOIN entity_dictionary other ON other.entity_type='asset' AND other.entity_key=d.asset
    UNION SELECT a.src,other.entity_id,${BIP_W},NULL FROM asset_sources a
      CROSS JOIN balances b ON b.asset_id=a.id AND b.address_id IS NOT NULL AND CAST(b.quantity AS INTEGER)>0
      JOIN address_dictionary d ON d.address_id=b.address_id
      JOIN entity_dictionary other ON other.entity_type='address' AND other.entity_key=d.address`
    : "";
  return `WITH sources AS MATERIALIZED (
      SELECT entity_id src,entity_type,entity_key FROM entity_dictionary WHERE entity_id>?1 AND entity_id<=?2
    ), address_sources AS MATERIALIZED (
      SELECT s.src,d.address_id id FROM sources s CROSS JOIN address_dictionary d ON d.address=s.entity_key WHERE s.entity_type='address'
    ), allowed AS MATERIALIZED (
      SELECT * FROM address_sources a WHERE NOT ${ENTITY_EXCLUDED("a.id")}
    ), asset_sources AS MATERIALIZED (
      SELECT s.src,d.asset_id id FROM sources s CROSS JOIN asset_dictionary d ON d.asset=s.entity_key WHERE s.entity_type='asset'
    ), flows(src,dst,height) AS (
      SELECT a.src,t.destination_id,t.block_index FROM allowed a CROSS JOIN sends t ON t.source_id=a.id
      WHERE t.destination_id<>a.id AND t.block_index>0 AND t.block_index<=?5
        AND NOT EXISTS(SELECT 1 FROM dispensers d WHERE d.source_id=t.destination_id AND d.origin_id=a.id)
      UNION ALL SELECT a.src,t.tx1_address_id,t.block_index FROM allowed a CROSS JOIN order_matches t ON t.tx0_address_id=a.id
      WHERE t.tx1_address_id<>a.id AND t.block_index>0 AND t.block_index<=?5
      UNION ALL SELECT a.src,t.tx0_address_id,t.block_index FROM allowed a CROSS JOIN order_matches t ON t.tx1_address_id=a.id
      WHERE t.tx0_address_id<>a.id AND t.block_index>0 AND t.block_index<=?5
      UNION ALL SELECT a.src,COALESCE(d.origin_id,t.source_id),t.block_index FROM allowed a
      CROSS JOIN dispenses t ON t.destination_id=a.id LEFT JOIN dispensers d ON d.tx_index=t.dispenser_tx_index
      WHERE COALESCE(d.origin_id,t.source_id)<>a.id AND t.block_index>0 AND t.block_index<=?5
    ), counts AS (
      SELECT src,dst,COUNT(*) n,MAX(height) height FROM flows GROUP BY src,dst
    ), expected(src,dst,w,h) AS MATERIALIZED (
      SELECT c.src,e.entity_id,CASE WHEN c.src<=${ENTITY_MAX} THEN LN(1+c.n) ELSE c.n END,c.height FROM counts c
      JOIN address_dictionary d ON d.address_id=c.dst JOIN entity_dictionary e ON e.entity_type='address' AND e.entity_key=d.address
      UNION SELECT a.src,e.entity_id,${BIP_W},NULL FROM asset_sources a
      CROSS JOIN assets t ON t.asset_id=a.id JOIN address_dictionary d ON d.address_id=t.issuer_id
      JOIN entity_dictionary e ON e.entity_type='address' AND e.entity_key=d.address
      UNION SELECT a.src,e.entity_id,${BIP_W},NULL FROM allowed a
      CROSS JOIN assets t ON t.issuer_id=a.id JOIN asset_dictionary d ON d.asset_id=t.asset_id
      JOIN entity_dictionary e ON e.entity_type='asset' AND e.entity_key=d.asset ${holdings}
    ), stored(src,dst,w,h) AS MATERIALIZED (
      SELECT source_entity_id,destination_entity_id,
        CASE WHEN revision<=?4 AND revision<>COALESCE((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_abandoned_revision'),-1) THEN next_weight ELSE weight END,
        CASE WHEN revision<=?4 AND revision<>COALESCE((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_abandoned_revision'),-1) THEN next_edge_block ELSE edge_block END
      FROM graph_edges WHERE generation=?3 AND source_entity_id>?1 AND source_entity_id<=?2
    )
    SELECT e.src,e.dst,e.w,e.h FROM expected e LEFT JOIN stored s ON s.src=e.src AND s.dst=e.dst
    WHERE e.w IS NOT s.w OR e.h IS NOT s.h
    UNION ALL SELECT s.src,s.dst,0,NULL FROM stored s WHERE s.w>0
      AND NOT EXISTS(SELECT 1 FROM expected e WHERE e.src=s.src AND e.dst=s.dst)
    ORDER BY 1,2 LIMIT 501`;
}

export interface EdgeChange {
  src: number;
  dst: number;
  w: number;
  h: number | null;
}

export function stageGraphChanges(
  db: D1Database,
  gen: number,
  revision: number,
  abandoned: number,
  changes: EdgeChange[],
) {
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < changes.length; i += 24) {
    const rows = changes.slice(i, i + 24);
    // An older staged value has already been published: carry it forward as the visible baseline.
    statements.push(
      db
        .prepare(
          `INSERT INTO graph_edges(generation,source_entity_id,destination_entity_id,weight,edge_block,revision,next_weight,next_edge_block)
      VALUES ${rows.map(() => `(${gen},?,?,0,NULL,${revision},?,?)`).join(",")}
      ON CONFLICT(generation,source_entity_id,destination_entity_id) DO UPDATE SET
        weight=CASE WHEN graph_edges.revision<excluded.revision AND graph_edges.revision<>${abandoned} THEN graph_edges.next_weight ELSE graph_edges.weight END,
        edge_block=CASE WHEN graph_edges.revision<excluded.revision AND graph_edges.revision<>${abandoned} THEN graph_edges.next_edge_block ELSE graph_edges.edge_block END,
        revision=excluded.revision,next_weight=excluded.next_weight,next_edge_block=excluded.next_edge_block`,
        )
        .bind(...rows.flatMap((r) => [r.src, r.dst, r.w, r.h])),
    );
  }
  return statements;
}
