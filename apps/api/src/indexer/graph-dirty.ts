import { BIP_W, ENTITY_EXCLUDED, ENTITY_MAX } from "#api/indexer/graph-core";
import { changedEligibilitySql, stageGraphChanges, type EdgeChange } from "#api/indexer/graph-diff";
import { getCoreStateInt, setCoreStateStatement } from "#api/indexer/core-state";

type DirtyPair = { kind: number; a: number; b: number };

// Freeze the inbox atomically. Changes during comparison, including a second change to
// the very same pair, enter the next epoch. The maintenance lease serializes consumers.
export async function startDirtyGraph(db: D1Database, requestedMode?: boolean) {
  const epoch = await getCoreStateInt(db, "graph_queue_epoch");
  const published = await getCoreStateInt(db, "graph_edge_revision");
  const abandoned = await getCoreStateInt(db, "graph_abandoned_revision", -1);
  const mode = await getCoreStateInt(db, "graph_bipartite");
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("Graph change capture unavailable");
  const tip = (await db.prepare("SELECT MAX(block_index) tip FROM blocks").first<{ tip: number }>())?.tip;
  if (!tip) throw new Error("Graph tip unavailable");
  const statements = [
    setCoreStateStatement(db, "graph_processing_epoch", epoch),
    setCoreStateStatement(db, "graph_queue_epoch", epoch + 1),
    setCoreStateStatement(db, "graph_diff_revision", Math.max(published, abandoned) + 1),
    setCoreStateStatement(db, "graph_diff_tip", tip),
    setCoreStateStatement(db, "graph_phase", "diff"),
    setCoreStateStatement(db, "graph_build_generation", await getCoreStateInt(db, "graph_generation")),
  ];
  if (requestedMode !== undefined && Number(requestedMode) !== mode) {
    statements.push(
      setCoreStateStatement(db, "graph_bipartite", Number(requestedMode)),
      setCoreStateStatement(db, "graph_holder_cursor", 0),
      db.prepare(
        "INSERT INTO core_state(key,value) SELECT 'graph_holder_end',COALESCE(MAX(balance_id),0) FROM balances WHERE 1 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ),
    );
  }
  await db.batch(statements);
}

// Source keys in the queue are native dictionary IDs. Resolve only endpoints of this
// batch, including entities introduced since publication.
function ensureEndpoints(db: D1Database, pairs: string) {
  return (["address", "asset"] as const).map((kind) => {
    const ids =
      kind === "asset" ? "SELECT b id FROM p WHERE kind=1" : "SELECT a id FROM p UNION SELECT b FROM p WHERE kind=0";
    return db
      .prepare(
        `WITH p AS (${unpack}), ids AS (${ids})
      INSERT INTO entity_dictionary(entity_type,entity_key)
      SELECT '${kind}',d.${kind} FROM ids CROSS JOIN ${kind}_dictionary d ON d.${kind}_id=ids.id
      WHERE 1 ON CONFLICT(entity_type,entity_key) DO NOTHING`,
      )
      .bind(pairs);
  });
}
const unpack = "SELECT value->>0 kind,value->>1 a,value->>2 b FROM json_each(?1)";

export function changedPairSql(bipartite: boolean) {
  const holding = bipartite
    ? " OR EXISTS(SELECT 1 FROM balances x WHERE x.address_id=p.a AND x.asset_id=p.b AND CAST(x.quantity AS INTEGER)>0)"
    : "";
  return `WITH p AS MATERIALIZED (${unpack}), addr AS MATERIALIZED (
    SELECT p.*,e.entity_id src, NOT ${ENTITY_EXCLUDED("p.a")} allowed FROM p
    CROSS JOIN address_dictionary d ON d.address_id=p.a CROSS JOIN entity_dictionary e ON e.entity_type='address' AND e.entity_key=d.address
  ), flow AS MATERIALIZED (
    SELECT p.*,e.entity_id dst FROM addr p CROSS JOIN address_dictionary d ON d.address_id=p.b
    CROSS JOIN entity_dictionary e ON e.entity_type='address' AND e.entity_key=d.address WHERE p.kind=0
  ), events(src,dst,height) AS (
    SELECT p.src,p.dst,t.block_index FROM flow p CROSS JOIN sends t ON t.source_id=p.a AND t.destination_id=p.b
    WHERE p.allowed AND t.block_index BETWEEN 1 AND ?2 AND NOT EXISTS(SELECT 1 FROM dispensers d WHERE d.source_id=p.b AND d.origin_id=p.a)
    UNION ALL SELECT p.src,p.dst,t.block_index FROM flow p CROSS JOIN order_matches t ON t.tx0_address_id=p.a AND t.tx1_address_id=p.b WHERE p.allowed AND t.block_index BETWEEN 1 AND ?2
    UNION ALL SELECT p.src,p.dst,t.block_index FROM flow p CROSS JOIN order_matches t ON t.tx1_address_id=p.a AND t.tx0_address_id=p.b WHERE p.allowed AND t.block_index BETWEEN 1 AND ?2
    UNION ALL SELECT p.src,p.dst,t.block_index FROM flow p CROSS JOIN dispenses t ON t.destination_id=p.a
      LEFT JOIN dispensers d ON d.tx_index=t.dispenser_tx_index WHERE p.allowed AND t.block_index BETWEEN 1 AND ?2 AND COALESCE(d.origin_id,t.source_id)=p.b
  ), counts AS (SELECT src,dst,COUNT(*) n,MAX(height) h FROM events GROUP BY src,dst),
  member AS MATERIALIZED (
    SELECT p.src,e.entity_id dst,p.allowed, (EXISTS(SELECT 1 FROM assets t WHERE t.asset_id=p.b AND t.issuer_id=p.a)${holding}) present
    FROM addr p CROSS JOIN asset_dictionary d ON d.asset_id=p.b CROSS JOIN entity_dictionary e ON e.entity_type='asset' AND e.entity_key=d.asset WHERE p.kind=1
  ), expected(src,dst,w,h) AS (
    SELECT p.src,p.dst,CASE WHEN c.n IS NULL THEN 0 WHEN p.src<=${ENTITY_MAX} THEN LN(1+c.n) ELSE c.n END,c.h FROM flow p LEFT JOIN counts c USING(src,dst)
    UNION ALL SELECT src,dst,CASE WHEN allowed AND present THEN ${BIP_W} ELSE 0 END,NULL FROM member
    UNION ALL SELECT dst,src,CASE WHEN present THEN ${BIP_W} ELSE 0 END,NULL FROM member
  )
  SELECT p.* FROM expected p LEFT JOIN graph_edges g ON g.generation=?3 AND g.source_entity_id=p.src AND g.destination_entity_id=p.dst
  WHERE p.w IS NOT COALESCE(CASE WHEN g.revision<=?4 AND g.revision<>?5 THEN g.next_weight ELSE g.weight END,0)
     OR p.h IS NOT CASE WHEN g.revision<=?4 AND g.revision<>?5 THEN g.next_edge_block ELSE g.edge_block END`;
}

// Bridge the interval between the last published edge watermark and trigger installation.
// Each query starts at an indexed block range. Subsequent refreshes use the inbox alone.
function catchup(db: D1Database, epoch: number, from: number, to: number, bipartite: boolean, gen: number) {
  const range = "block_index>?2 AND block_index<=?3";
  const selects = [
    `SELECT 0,source_id,destination_id FROM sends WHERE ${range}`,
    `SELECT 0,tx0_address_id,tx1_address_id FROM order_matches WHERE ${range}`,
    `SELECT 0,tx1_address_id,tx0_address_id FROM order_matches WHERE ${range}`,
    `SELECT 0,t.destination_id,COALESCE(d.origin_id,t.source_id) FROM dispenses t LEFT JOIN dispensers d ON d.tx_index=t.dispenser_tx_index WHERE t.block_index>?2 AND t.block_index<=?3`,
    `SELECT 0,origin_id,source_id FROM dispensers WHERE ${range}`,
    `SELECT 0,t.destination_id,t.source_id FROM dispensers d CROSS JOIN dispenses t ON t.dispenser_tx_index=d.tx_index WHERE d.block_index>?2 AND d.block_index<=?3`,
    `SELECT 0,t.destination_id,COALESCE(d.origin_id,t.source_id) FROM dispensers d CROSS JOIN dispenses t ON t.dispenser_tx_index=d.tx_index WHERE d.block_index>?2 AND d.block_index<=?3`,
    `SELECT 1,issuer_id,asset_id FROM issuances WHERE ${range}`,
    `SELECT 1,source_id,asset_id FROM issuances WHERE ${range}`,
    `SELECT 1,t.issuer_id,i.asset_id FROM issuances i CROSS JOIN assets t ON t.asset_id=i.asset_id WHERE i.block_index>?2 AND i.block_index<=?3`,
    `SELECT 1,a.address_id,i.asset_id FROM (SELECT DISTINCT asset_id FROM issuances WHERE ${range}) i
        CROSS JOIN asset_dictionary d ON d.asset_id=i.asset_id CROSS JOIN entity_dictionary src ON src.entity_type='asset' AND src.entity_key=d.asset
        CROSS JOIN published_graph_edges g ON g.generation=${gen} AND g.source_entity_id=src.entity_id
        CROSS JOIN entity_dictionary dst ON dst.entity_id=g.destination_entity_id AND dst.entity_type='address' CROSS JOIN address_dictionary a ON a.address=dst.entity_key`,
  ];
  if (bipartite) selects.push(`SELECT 1,address_id,asset_id FROM ledger_events WHERE ${range}`);
  return db.batch([
    ...selects.map((sql) =>
      db
        .prepare(
          `WITH candidates(kind,a,b) AS (${sql}) INSERT INTO graph_dirty_pairs SELECT DISTINCT ?1,kind,a,b FROM candidates WHERE a IS NOT NULL AND b IS NOT NULL AND (kind<>0 OR a<>b) ON CONFLICT DO NOTHING`,
        )
        .bind(epoch, from, to),
    ),
    setCoreStateStatement(db, "graph_catchup_cursor", to),
  ]);
}

export async function advanceDirtyGraph(db: D1Database) {
  const state = Object.fromEntries(
    (
      await db
        .prepare(
          `SELECT key,value FROM core_state WHERE key IN
    ('graph_processing_epoch','graph_diff_revision','graph_abandoned_revision','graph_diff_tip','graph_generation','graph_bipartite','graph_capture_tip','graph_catchup_cursor','graph_holder_cursor','graph_holder_end')`,
        )
        .all<{ key: string; value: string }>()
    ).results.map((r) => [r.key, Number(r.value)]),
  );
  const epoch = state.graph_processing_epoch,
    rev = state.graph_diff_revision,
    gen = state.graph_generation,
    tip = state.graph_diff_tip,
    abandoned = state.graph_abandoned_revision ?? -1,
    bipartite = state.graph_bipartite === 1;
  if (![epoch, rev, gen, tip].every((n) => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(abandoned))
    throw new Error("Invalid dirty graph checkpoint");
  const progress = { phase: "diff", done: false };
  if (state.graph_catchup_cursor < state.graph_capture_tip) {
    const to = Math.min(state.graph_capture_tip, state.graph_catchup_cursor + 128);
    await catchup(db, epoch, state.graph_catchup_cursor, to, bipartite, gen);
    return { ...progress, note: `captured pre-migration events through block ${to}` };
  }
  if (state.graph_holder_cursor < state.graph_holder_end) {
    const from = state.graph_holder_cursor,
      to = Math.min(from + 512, state.graph_holder_end);
    await db.batch([
      db
        .prepare(
          `INSERT INTO graph_dirty_pairs SELECT ?1,1,address_id,asset_id FROM balances
      WHERE balance_id>?2 AND balance_id<=?3 AND address_id IS NOT NULL AND CAST(quantity AS INTEGER)>0 ON CONFLICT DO NOTHING`,
        )
        .bind(epoch, from, to),
      ...(to === state.graph_holder_end
        ? [db.prepare("DELETE FROM core_state WHERE key IN ('graph_holder_cursor','graph_holder_end')")]
        : [setCoreStateStatement(db, "graph_holder_cursor", to)]),
    ]);
    return { ...progress, note: "tracking changed holder policy" };
  }
  const pairs = (
    await db
      .prepare("SELECT kind,a,b FROM graph_dirty_pairs WHERE epoch=? ORDER BY kind,a,b LIMIT 32")
      .bind(epoch)
      .all<DirtyPair>()
  ).results;
  if (!pairs.length) {
    await setCoreStateStatement(db, "graph_phase", "score").run();
    return { ...progress, phase: "score", note: "changed pairs exhausted" };
  }
  const exclusion = pairs[0].kind === 2;
  const batch = exclusion ? pairs.slice(0, 1) : pairs.filter((p) => p.kind !== 2);
  const payload = JSON.stringify(batch.map((p) => [p.kind, p.a, p.b]));
  await db.batch(ensureEndpoints(db, payload));
  let changes: EdgeChange[],
    complete = true;
  if (exclusion) {
    // Every outgoing edge of this particular address is affected by an eligibility flip.
    const identity = await db
      .prepare(
        "SELECT e.entity_id id FROM address_dictionary d JOIN entity_dictionary e ON e.entity_type='address' AND e.entity_key=d.address WHERE d.address_id=?",
      )
      .bind(batch[0].a)
      .first<{ id: number }>();
    const id = identity?.id;
    const rows = id
      ? (
          await db
            .prepare(changedEligibilitySql(bipartite))
            .bind(id, batch[0].a, gen, rev, tip, abandoned)
            .all<EdgeChange>()
        ).results
      : [];
    complete = rows.length <= 500;
    changes = rows.slice(0, 500);
  } else {
    changes = (await db.prepare(changedPairSql(bipartite)).bind(payload, tip, gen, rev, abandoned).all<EdgeChange>())
      .results;
  }
  const writes = stageGraphChanges(db, gen, rev, abandoned, changes);
  if (complete)
    writes.push(
      db
        .prepare(`DELETE FROM graph_dirty_pairs WHERE (epoch,kind,a,b) IN (SELECT ?2,kind,a,b FROM (${unpack}))`)
        .bind(payload, epoch),
    );
  await db.batch(writes);
  return {
    ...progress,
    changed_pairs: changes.length,
    checked_keys: batch.length,
    note: `${changes.length} changed edges`,
  };
}
