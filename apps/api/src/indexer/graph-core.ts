/**
 * Graph-reputation trait: environment-free math and SQL builders shared by production and tests, so the
 * validation harness (tests/graph.test.ts) and the read layer can import the engine/tier logic WITHOUT
 * pulling in the Worker Env (which transitively drags the whole read router into the test compile). The
 * power iteration runs here as a dense in-memory engine; only the edge/seed builders remain SQL. See
 * graph.ts for the job that drives these against D1, and docs/graph-reputation.md.
 */

// ---- tuning constants ----
export const ALPHA = 0.85; // PPR damping (the doc's value; convergence depends on this, not graph size)
export const PASSES = 20; // power-iteration passes per slot (stable ordering by ~20 per the doc)
export const K = 3; // trust seed subsets (Min-k). slots 0..K-1 = trust, slot K = distrust
export const DISTRUST_SLOT = K; // slot 3
export const BIP_W = "0.6931471805599453"; // ln(2): the constant bipartite edge weight (count is always 1 per pair)

/** Deterministic k-split: FNV-1a over the node id, mod K. Stable across rebuilds; reproducible in the harness. */
export function seedSubset(key: string, k = K): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % k;
}

export type GraphTier = "trusted" | "distrusted" | "unscored";

/**
 * Tier from the (trust, distrust) pair. NOT a continuum:
 *   - unscored   : never reached from any seed set (trust==0 AND distrust==0). Fresh sybils AND legitimate
 *                  newcomers both land here; resistance by default, at the documented cost that a newcomer is
 *                  "unscored", never "bad".
 *   - distrusted : the reverse-graph run reaches it more strongly than the (conservative, MIN-of-k) trust run.
 *   - trusted    : reached by ALL k trust subsets at least as strongly as by the scam seeds.
 * trust is a MIN over k vectors so it is deliberately conservative vs the single distrust vector; ties break
 * toward distrusted (the safe direction).
 */
// cuts: magnitude thresholds (p90 of the positive mass, computed at finalize into indexer_state).
// The first prod run showed why they're needed: 12 years of organic mixing gives ~60% of addresses SOME
// nonzero trust; "trusted" must mean meaningfully trusted, so weak-positive collapses to unscored.
// Defaults of 0 preserve the pure zero/nonzero semantics (the harness gauntlet exercises that path).
export interface GraphCuts {
  trust: number;
  distrust: number;
}
export function graphTier(trust: number, distrust: number, cuts: GraphCuts = { trust: 0, distrust: 0 }): GraphTier {
  const t = trust > 0 ? trust : 0;
  const d = distrust > 0 ? distrust : 0;
  if (d > t && d > cuts.distrust) return "distrusted";
  if (t > 0 && t >= d && t >= cuts.trust) return "trusted";
  return "unscored";
}

// ---- in-memory score engine ----------------------------------------------------------------
// The power iteration runs entirely in Worker memory: D1 pays ~660k row writes per full-table UPDATE,
// and the SQL form of these passes cost ~200M billed row writes per weekly rebuild. The engine reads the
// persisted graph_edges once, iterates dense typed arrays, and hands back final vectors for a delta write.

/** Directed weighted edges in entity-id space; the three arrays are index-aligned. */
export interface GraphEdgeArrays {
  source: Uint32Array;
  destination: Uint32Array;
  weight: Float64Array;
  edgeCount: number;
}

/** Entity ids remapped onto 0..nodeCount-1 with per-node degree sums (only entities that touch an edge). */
export interface DenseGraph {
  denseOf: Int32Array; // entity_id -> dense index, -1 when the entity has no edges
  entityOf: Uint32Array; // dense index -> entity_id
  outsum: Float64Array;
  insum: Float64Array;
  nodeCount: number;
}

export function buildDenseGraph(edges: GraphEdgeArrays, maxEntityId: number): DenseGraph {
  const denseOf = new Int32Array(maxEntityId + 1).fill(-1);
  let nodeCount = 0;
  for (let e = 0; e < edges.edgeCount; e++) {
    if (denseOf[edges.source[e]] < 0) denseOf[edges.source[e]] = nodeCount++;
    if (denseOf[edges.destination[e]] < 0) denseOf[edges.destination[e]] = nodeCount++;
  }
  const entityOf = new Uint32Array(nodeCount);
  for (let id = 0; id <= maxEntityId; id++) if (denseOf[id] >= 0) entityOf[denseOf[id]] = id;
  const outsum = new Float64Array(nodeCount);
  const insum = new Float64Array(nodeCount);
  for (let e = 0; e < edges.edgeCount; e++) {
    outsum[denseOf[edges.source[e]]] += edges.weight[e];
    insum[denseOf[edges.destination[e]]] += edges.weight[e];
  }
  return { denseOf, entityOf, outsum, insum, nodeCount };
}

/** A staged teleport-vector entry (slots 0..K-1 trust subsets, slot K distrust). */
export interface GraphSeed {
  entityId: number;
  slot: number;
  score: number;
}

/**
 * One personalized-PageRank vector: rank starts at the seed vector, then `passes` degree-normalized
 * damped passes (reverse walks the edges destination->source for Anti-TrustRank). Mirrors the retired
 * SQL passes exactly: teleport mass tele*seed everywhere, alpha*weight/degree-sum flow along edges.
 */
export function iterateGraphSlot(
  graph: DenseGraph,
  edges: GraphEdgeArrays,
  seedScore: Float64Array,
  reverse: boolean,
  passes = PASSES,
  alpha = ALPHA,
): Float64Array {
  const tele = 1 - alpha;
  let rank = Float64Array.from(seedScore);
  let next = new Float64Array(graph.nodeCount);
  const flow = new Float64Array(graph.nodeCount); // rank/degree-sum, hoisted out of the edge loop
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < graph.nodeCount; i++) next[i] = tele * seedScore[i];
    if (reverse) {
      for (let i = 0; i < graph.nodeCount; i++) flow[i] = graph.insum[i] > 0 ? (alpha * rank[i]) / graph.insum[i] : 0;
      for (let e = 0; e < edges.edgeCount; e++) {
        const d = graph.denseOf[edges.destination[e]];
        if (flow[d] !== 0) next[graph.denseOf[edges.source[e]]] += edges.weight[e] * flow[d];
      }
    } else {
      for (let i = 0; i < graph.nodeCount; i++) flow[i] = graph.outsum[i] > 0 ? (alpha * rank[i]) / graph.outsum[i] : 0;
      for (let e = 0; e < edges.edgeCount; e++) {
        const s = graph.denseOf[edges.source[e]];
        if (flow[s] !== 0) next[graph.denseOf[edges.destination[e]]] += edges.weight[e] * flow[s];
      }
    }
    [rank, next] = [next, rank];
  }
  return rank;
}

/** Final per-node vectors: trust = MIN over the k subsets (seeds keep their MAX), distrust = reverse run. */
export function computeGraphScores(
  graph: DenseGraph,
  edges: GraphEdgeArrays,
  seeds: readonly GraphSeed[],
): { trust: Float64Array; distrust: Float64Array } {
  const seedVector = (slot: number): Float64Array => {
    const score = new Float64Array(graph.nodeCount);
    for (const seed of seeds) {
      if (seed.slot !== slot || seed.entityId >= graph.denseOf.length) continue;
      const dense = graph.denseOf[seed.entityId];
      if (dense >= 0) score[dense] = seed.score;
    }
    return score;
  };
  const trustSeeded = new Uint8Array(graph.nodeCount);
  for (const seed of seeds) {
    if (seed.slot >= K || seed.entityId >= graph.denseOf.length) continue;
    const dense = graph.denseOf[seed.entityId];
    if (dense >= 0) trustSeeded[dense] = 1;
  }
  const trust = new Float64Array(graph.nodeCount).fill(Number.POSITIVE_INFINITY);
  const seedMax = new Float64Array(graph.nodeCount);
  for (let slot = 0; slot < K; slot++) {
    const rank = iterateGraphSlot(graph, edges, seedVector(slot), false);
    for (let i = 0; i < graph.nodeCount; i++) {
      if (rank[i] < trust[i]) trust[i] = rank[i];
      if (trustSeeded[i] === 1 && rank[i] > seedMax[i]) seedMax[i] = rank[i];
    }
  }
  // A seed is axiomatically trusted: MIN would punish it for landing in exactly one subset.
  for (let i = 0; i < graph.nodeCount; i++) if (trustSeeded[i] === 1) trust[i] = seedMax[i];
  const distrust = iterateGraphSlot(graph, edges, seedVector(DISTRUST_SLOT), true);
  return { trust, distrust };
}

/**
 * Stored precision for the published scores: 4 significant digits. The consumers are tier cuts and
 * leaderboard ordering; quantizing keeps float drift from forcing a full-table rewrite every rebuild.
 */
export function quantizeGraphScore(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toPrecision(4));
}

/** The finalize percentile (ascending offset floor(n*pct)), matching the retired SQL cut expression. */
export function graphPercentileCut(positiveValues: number[], percentile: number): number {
  if (positiveValues.length === 0) return 0;
  const sorted = [...positiveValues].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))];
}

const BLOCK_CHUNK = 100_000;
const BLOCK_MAX = 1_200_000;
const blockWindows: Array<[number, number]> = [];
for (let lo = 0; lo < BLOCK_MAX; lo += BLOCK_CHUNK) blockWindows.push([lo, lo + BLOCK_CHUNK]);

const BAL_CHUNK = 250_000;
const BAL_MAX = 4_000_000;
const balWindows: Array<[number, number]> = [];
for (let lo = 0; lo < BAL_MAX; lo += BAL_CHUNK) balWindows.push([lo, lo + BAL_CHUNK]);

// ---- normalized entity graph ---------------------------------------------------------------
// Addresses and assets share entity_dictionary identities. Each rebuild is isolated by generation,
// and the completed generation becomes visible only when finalization publishes it.
const ENTITY_CHUNK = 50_000;
const ENTITY_MAX = 1_000_000;
const entityWindows: Array<[number, number]> = [];
for (let lo = 0; lo < ENTITY_MAX; lo += ENTITY_CHUNK) entityWindows.push([lo, lo + ENTITY_CHUNK]);

export function entitySeedInsertStatement(generation: number, rows: number): string {
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError("graph seed insert requires at least one row");
  return `INSERT INTO graph_seed(generation,entity_id,slot,score)
          SELECT ${generation},entity.entity_id,input.column3,input.column4
          FROM (VALUES ${Array.from({ length: rows }, () => "(?,?,?,?)").join(",")}) input
          JOIN entity_dictionary entity ON entity.entity_type=input.column1 AND entity.entity_key=input.column2
          WHERE true
          ON CONFLICT(generation,entity_id,slot) DO UPDATE SET score=excluded.score`;
}

const ENTITY_EXCLUDED = (addressId: string) => `(
  EXISTS (SELECT 1 FROM address_signals signal WHERE signal.address_id=${addressId}
           AND (signal.is_exchange=1 OR signal.is_burn=1 OR signal.is_deposit=1
                OR signal.is_emblem_vault=1))
  OR EXISTS (SELECT 1 FROM address_dictionary address JOIN curated
              ON curated.key=address.address AND curated.kind IN ('exchange','burn')
             WHERE address.address_id=${addressId})
)`;

const entityCountEdges = (generation: number, select: (lo: number, hi: number) => string): string[] =>
  blockWindows.map(
    ([lo, hi]) =>
      `INSERT INTO graph_edges(generation,source_entity_id,destination_entity_id,weight,edge_block)
       ${select(lo, hi)}
       ON CONFLICT(generation,source_entity_id,destination_entity_id) DO UPDATE SET
         weight=graph_edges.weight+excluded.weight,
         edge_block=MAX(graph_edges.edge_block,excluded.edge_block)`,
  );

/** Ensure every canonical address and asset has the polymorphic identity consumed by graph relations. */
export const ENTITY_IDENTITY_STATEMENTS = [
  `INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
   SELECT 'address',address FROM address_dictionary`,
  `INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
   SELECT 'asset',asset FROM asset_dictionary`,
] as const;

/** Build one isolated normalized edge generation from the canonical protocol tables. */
export function entityEdgeStatements(generation: number, bipartite = false): string[] {
  const statements: string[] = [
    ...entityCountEdges(
      generation,
      (lo, hi) => `SELECT ${generation},source.entity_id,destination.entity_id,COUNT(*),MAX(send.block_index)
       FROM sends send
       JOIN address_dictionary source_address ON source_address.address_id=send.source_id
       JOIN entity_dictionary source ON source.entity_type='address'
         AND source.entity_key=source_address.address
       JOIN address_dictionary destination_address ON destination_address.address_id=send.destination_id
       JOIN entity_dictionary destination ON destination.entity_type='address'
         AND destination.entity_key=destination_address.address
       WHERE send.block_index>${lo} AND send.block_index<=${hi}
         AND send.source_id IS NOT NULL AND send.destination_id IS NOT NULL
         AND send.source_id<>send.destination_id AND NOT ${ENTITY_EXCLUDED("send.source_id")}
         AND NOT EXISTS (SELECT 1 FROM dispensers dispenser
                          WHERE dispenser.source_id=send.destination_id AND dispenser.origin_id=send.source_id)
       GROUP BY source.entity_id,destination.entity_id`,
    ),
    ...entityCountEdges(
      generation,
      (lo, hi) => `SELECT ${generation},source.entity_id,destination.entity_id,COUNT(*),MAX(match.block_index)
       FROM order_matches match
       JOIN address_dictionary source_address ON source_address.address_id=match.tx0_address_id
       JOIN entity_dictionary source ON source.entity_type='address' AND source.entity_key=source_address.address
       JOIN address_dictionary destination_address ON destination_address.address_id=match.tx1_address_id
       JOIN entity_dictionary destination ON destination.entity_type='address'
         AND destination.entity_key=destination_address.address
       WHERE match.block_index>${lo} AND match.block_index<=${hi}
         AND match.tx0_address_id IS NOT NULL AND match.tx1_address_id IS NOT NULL
         AND match.tx0_address_id<>match.tx1_address_id AND NOT ${ENTITY_EXCLUDED("match.tx0_address_id")}
       GROUP BY source.entity_id,destination.entity_id`,
    ),
    ...entityCountEdges(
      generation,
      (lo, hi) => `SELECT ${generation},source.entity_id,destination.entity_id,COUNT(*),MAX(match.block_index)
       FROM order_matches match
       JOIN address_dictionary source_address ON source_address.address_id=match.tx1_address_id
       JOIN entity_dictionary source ON source.entity_type='address' AND source.entity_key=source_address.address
       JOIN address_dictionary destination_address ON destination_address.address_id=match.tx0_address_id
       JOIN entity_dictionary destination ON destination.entity_type='address'
         AND destination.entity_key=destination_address.address
       WHERE match.block_index>${lo} AND match.block_index<=${hi}
         AND match.tx0_address_id IS NOT NULL AND match.tx1_address_id IS NOT NULL
         AND match.tx0_address_id<>match.tx1_address_id AND NOT ${ENTITY_EXCLUDED("match.tx1_address_id")}
       GROUP BY source.entity_id,destination.entity_id`,
    ),
    ...entityCountEdges(
      generation,
      (lo, hi) => `SELECT ${generation},buyer.entity_id,operator.entity_id,COUNT(*),MAX(dispense.block_index)
       FROM dispenses dispense LEFT JOIN dispensers dispenser ON dispenser.tx_index=dispense.dispenser_tx_index
       JOIN address_dictionary buyer_address ON buyer_address.address_id=dispense.destination_id
       JOIN entity_dictionary buyer ON buyer.entity_type='address' AND buyer.entity_key=buyer_address.address
       JOIN address_dictionary operator_address
         ON operator_address.address_id=COALESCE(dispenser.origin_id,dispense.source_id)
       JOIN entity_dictionary operator ON operator.entity_type='address' AND operator.entity_key=operator_address.address
       WHERE dispense.block_index>${lo} AND dispense.block_index<=${hi}
         AND dispense.destination_id IS NOT NULL AND COALESCE(dispenser.origin_id,dispense.source_id) IS NOT NULL
         AND dispense.destination_id<>COALESCE(dispenser.origin_id,dispense.source_id)
         AND NOT ${ENTITY_EXCLUDED("dispense.destination_id")}
       GROUP BY buyer.entity_id,operator.entity_id`,
    ),
  ];
  for (const [lo, hi] of entityWindows)
    statements.push(
      `UPDATE graph_edges SET weight=LN(1+weight) WHERE generation=${generation}
       AND source_entity_id>${lo} AND source_entity_id<=${hi}`,
    );
  statements.push(
    `INSERT INTO graph_edges(generation,source_entity_id,destination_entity_id,weight)
     SELECT ${generation},asset_entity.entity_id,issuer_entity.entity_id,${BIP_W}
     FROM assets state
     JOIN asset_dictionary asset ON asset.asset_id=state.asset_id
     JOIN entity_dictionary asset_entity ON asset_entity.entity_type='asset' AND asset_entity.entity_key=asset.asset
     JOIN address_dictionary issuer ON issuer.address_id=state.issuer_id
     JOIN entity_dictionary issuer_entity ON issuer_entity.entity_type='address' AND issuer_entity.entity_key=issuer.address
     WHERE state.issuer_id IS NOT NULL
     ON CONFLICT(generation,source_entity_id,destination_entity_id) DO NOTHING`,
    `INSERT INTO graph_edges(generation,source_entity_id,destination_entity_id,weight)
     SELECT ${generation},issuer_entity.entity_id,asset_entity.entity_id,${BIP_W}
     FROM assets state
     JOIN asset_dictionary asset ON asset.asset_id=state.asset_id
     JOIN entity_dictionary asset_entity ON asset_entity.entity_type='asset' AND asset_entity.entity_key=asset.asset
     JOIN address_dictionary issuer ON issuer.address_id=state.issuer_id
     JOIN entity_dictionary issuer_entity ON issuer_entity.entity_type='address' AND issuer_entity.entity_key=issuer.address
     WHERE state.issuer_id IS NOT NULL AND NOT ${ENTITY_EXCLUDED("state.issuer_id")}
     ON CONFLICT(generation,source_entity_id,destination_entity_id) DO NOTHING`,
  );
  if (bipartite)
    for (const [lo, hi] of balWindows) {
      statements.push(
        `INSERT INTO graph_edges(generation,source_entity_id,destination_entity_id,weight)
         SELECT ${generation},holder_entity.entity_id,asset_entity.entity_id,${BIP_W}
         FROM balances balance
         JOIN address_dictionary holder ON holder.address_id=balance.address_id
         JOIN entity_dictionary holder_entity ON holder_entity.entity_type='address'
           AND holder_entity.entity_key=holder.address
         JOIN asset_dictionary asset ON asset.asset_id=balance.asset_id
         JOIN entity_dictionary asset_entity ON asset_entity.entity_type='asset' AND asset_entity.entity_key=asset.asset
         WHERE balance.balance_id>${lo} AND balance.balance_id<=${hi}
           AND balance.address_id IS NOT NULL AND CAST(balance.quantity AS INTEGER)>0
           AND NOT ${ENTITY_EXCLUDED("balance.address_id")}
         ON CONFLICT(generation,source_entity_id,destination_entity_id) DO NOTHING`,
        `INSERT INTO graph_edges(generation,source_entity_id,destination_entity_id,weight)
         SELECT ${generation},asset_entity.entity_id,holder_entity.entity_id,${BIP_W}
         FROM balances balance
         JOIN address_dictionary holder ON holder.address_id=balance.address_id
         JOIN entity_dictionary holder_entity ON holder_entity.entity_type='address'
           AND holder_entity.entity_key=holder.address
         JOIN asset_dictionary asset ON asset.asset_id=balance.asset_id
         JOIN entity_dictionary asset_entity ON asset_entity.entity_type='asset' AND asset_entity.entity_key=asset.asset
         WHERE balance.balance_id>${lo} AND balance.balance_id<=${hi}
           AND balance.address_id IS NOT NULL AND CAST(balance.quantity AS INTEGER)>0
         ON CONFLICT(generation,source_entity_id,destination_entity_id) DO NOTHING`,
      );
    }
  return statements;
}
