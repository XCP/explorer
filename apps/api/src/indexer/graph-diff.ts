import { BIP_W, ENTITY_EXCLUDED, ENTITY_MAX } from "#api/indexer/graph-core";
import { getCoreStateInt, setCoreStateStatement } from "#api/indexer/core-state";

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
        CASE WHEN revision<=?4 THEN next_weight ELSE weight END,
        CASE WHEN revision<=?4 THEN next_edge_block ELSE edge_block END
      FROM graph_edges WHERE generation=?3 AND source_entity_id>?1 AND source_entity_id<=?2
    )
    SELECT e.src,e.dst,e.w,e.h FROM expected e LEFT JOIN stored s ON s.src=e.src AND s.dst=e.dst
    WHERE e.w IS NOT s.w OR e.h IS NOT s.h
    UNION ALL SELECT s.src,s.dst,0,NULL FROM stored s WHERE s.w>0
      AND NOT EXISTS(SELECT 1 FROM expected e WHERE e.src=s.src AND e.dst=s.dst)
    ORDER BY 1,2 LIMIT 501`;
}

interface EdgeChange {
  src: number;
  dst: number;
  w: number;
  h: number | null;
}

export async function startGraphDiff(db: D1Database, bipartite: boolean) {
  // Dictionaries can gain entries between rebuilds. Existing identities require no writes.
  for (const kind of ["address", "asset"]) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
      SELECT ?,d.${kind} FROM ${kind}_dictionary d WHERE NOT EXISTS
      (SELECT 1 FROM entity_dictionary e WHERE e.entity_type=? AND e.entity_key=d.${kind}) LIMIT 500`,
      )
      .bind(kind, kind)
      .run();
    if (result.meta.changes === 500) return false;
  }
  const tip = await db.prepare("SELECT MAX(block_index) b FROM blocks").first<number>("b");
  const revision = await getCoreStateInt(db, "graph_edge_revision", 0);
  const active = await getCoreStateInt(db, "graph_generation", 0);
  const last = await db
    .prepare(
      `SELECT MAX(COALESCE((SELECT MAX(entity_id) FROM entity_dictionary),0),
    COALESCE((SELECT MAX(source_entity_id) FROM graph_edges WHERE generation=?),0)) AS e`,
    )
    .bind(active)
    .first<number>("e");
  if (!active || !tip || !last) throw new Error("Missing published graph or canonical tip");
  await db.batch([
    setCoreStateStatement(db, "graph_diff_tip", tip),
    setCoreStateStatement(db, "graph_diff_end", last),
    setCoreStateStatement(db, "graph_diff_cursor", 0),
    setCoreStateStatement(db, "graph_diff_revision", revision + 1),
    setCoreStateStatement(db, "graph_build_generation", active),
    setCoreStateStatement(db, "graph_bipartite", bipartite ? 1 : 0),
    setCoreStateStatement(db, "graph_phase", "diff"),
  ]);
  return true;
}

export async function advanceGraphDiff(db: D1Database) {
  const state = Object.fromEntries(
    (
      await db
        .prepare(
          `SELECT key,value FROM core_state
      WHERE key IN ('graph_diff_cursor','graph_diff_end','graph_diff_revision','graph_generation','graph_bipartite','graph_diff_tip')`,
        )
        .all<{ key: string; value: string }>()
    ).results.map((r) => [r.key, Number(r.value)]),
  );
  const from = state.graph_diff_cursor,
    end = state.graph_diff_end,
    revision = state.graph_diff_revision,
    gen = state.graph_generation;
  if (
    ![from, end, revision, gen, state.graph_diff_tip].every(Number.isSafeInteger) ||
    end < from ||
    revision < 1 ||
    gen < 1
  )
    throw new Error("Invalid differential graph checkpoint");
  const to = Math.min(end, from + 512);
  const result = await db
    .prepare(graphDiffSql(state.graph_bipartite === 1))
    .bind(from, to, gen, revision, state.graph_diff_tip)
    .all<EdgeChange>();
  const changes = result.results.slice(0, 500);
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
        weight=CASE WHEN graph_edges.revision<excluded.revision THEN graph_edges.next_weight ELSE graph_edges.weight END,
        edge_block=CASE WHEN graph_edges.revision<excluded.revision THEN graph_edges.next_edge_block ELSE graph_edges.edge_block END,
        revision=excluded.revision,next_weight=excluded.next_weight,next_edge_block=excluded.next_edge_block`,
        )
        .bind(...rows.flatMap((r) => [r.src, r.dst, r.w, r.h])),
    );
  }
  const complete = result.results.length <= 500;
  if (complete) {
    statements.push(setCoreStateStatement(db, "graph_diff_cursor", to));
    if (to === end) statements.push(setCoreStateStatement(db, "graph_phase", "score"));
  }
  const writes = await db.batch(statements);
  return {
    phase: "diff",
    done: false,
    source_through: complete ? to : from,
    changed_pairs: changes.length,
    comparison_rows_read: result.meta?.rows_read,
    batch_rows_written: writes.reduce((sum, r) => sum + r.meta.rows_written, 0),
    note: `sources ${from + 1}-${to}, ${changes.length} changed edges`,
  };
}
