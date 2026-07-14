/**
 * Graph-reputation trait — the Env-free CORE (pure functions + SQL string builders). Split out from graph.ts
 * so the validation harness (tests/graph.test.ts) and the read layer can import the iteration/finalize/tier
 * logic WITHOUT pulling in the Worker Env (which transitively drags the whole read router into the test
 * compile). See graph.ts for the bounded job that drives these against D1, and docs/graph-reputation.md.
 */

// ---- tuning constants ----
export const ALPHA = 0.85; // PPR damping (the doc's value; convergence depends on this, not graph size)
export const PASSES = 20; // power-iteration passes per slot (stable ordering by ~20 per the doc)
export const K = 3; // trust seed subsets (Min-k). slots 0..K-1 = trust, slot K = distrust
export const DISTRUST_SLOT = K; // slot 3
export const ASSET_PREFIX = "asset:"; // asset node id namespace so an asset never collides with a bitcoin address
export const BIP_W = "0.6931471805599453"; // ln(2): the constant bipartite edge weight (count is always 1 per pair)

// MACHINES AND CONDUITS DON'T VOUCH: trust is only emitted where an outbound relation reflects a
// human choice. Excluded as trust SOURCES: curated exchanges + burns, detected exchange deposit
// addresses (forwarding pipes), Emblem vault addresses (custody boxes, not collectors — matters
// most for the bipartite holder edges), and likely-service addresses. They may still RECEIVE
// (sinks are harmless under damping); they never pour. Subquery reused in every edge insert.
export const EXCLUDE_SRC = `(SELECT key FROM curated WHERE kind IN ('exchange','burn')
  UNION SELECT address FROM address_signals WHERE is_deposit=1 OR is_emblem_vault=1 OR likely_service=1)`;

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
 *                  newcomers both land here — resistance by default, at the documented cost that a newcomer is
 *                  "unscored", never "bad".
 *   - distrusted : the reverse-graph run reaches it more strongly than the (conservative, MIN-of-k) trust run.
 *   - trusted    : reached by ALL k trust subsets at least as strongly as by the scam seeds.
 * trust is a MIN over k vectors so it is deliberately conservative vs the single distrust vector — ties break
 * toward distrusted (the safe direction).
 */
// cuts: magnitude thresholds (p90 of the positive mass, computed at finalize into indexer_state).
// The first prod run showed why they're needed: 12 years of organic mixing gives ~60% of addresses SOME
// nonzero trust — "trusted" must mean meaningfully-trusted, so weak-positive collapses to unscored.
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

/**
 * The three SQL statements of ONE power-iteration pass for a slot: (1) reset next = (1-α)·teleport, (2) add
 * α·(degree-normalized inflow) via a single UPDATE-JOIN aggregation over the edge table, (3) commit next->cur.
 * forward (trust slots): inflow into dst, normalized by the source's out-degree. reverse (distrust slot):
 * inflow into src along the reversed edge, normalized by the destination's in-degree. slot/alpha are numeric
 * literals (never binds) so the SQL is identical between D1 and the node:sqlite harness.
 */
export function passStatements(slot: number, reverse: boolean, alpha = ALPHA): string[] {
  const tele = 1 - alpha;
  const reset = `UPDATE graph_rank SET rn = ${tele} * s WHERE slot = ${slot}`;
  // The inflow aggregation is CHUNKED by edge rowid windows (a single full-edge UPDATE-JOIN exceeded
  // D1's per-op CPU limit on the ~2.5M-edge prod graph): each chunk accumulates degree-normalized
  // inflow into graph_inflow (ON CONFLICT ADD), then one small apply-join updates graph_rank. The
  // chunk grid is fixed (empty windows no-op) so the statement list is deterministic across calls
  // and identical between D1 and the node:sqlite harness.
  const inflowChunks = rowidWindows.map(([lo, hi]) =>
    reverse
      ? `INSERT INTO graph_inflow (node, v)
       SELECT e.src, SUM(e.w / n.insum * rr.r)
       FROM graph_edges e
       JOIN graph_node n ON n.id = e.dst
       JOIN graph_rank rr ON rr.node = e.dst AND rr.slot = ${slot}
       WHERE e.rowid > ${lo} AND e.rowid <= ${hi} AND n.insum > 0 AND rr.r <> 0
       GROUP BY e.src
       ON CONFLICT(node) DO UPDATE SET v = graph_inflow.v + excluded.v`
      : `INSERT INTO graph_inflow (node, v)
       SELECT e.dst, SUM(e.w / n.outsum * rr.r)
       FROM graph_edges e
       JOIN graph_node n ON n.id = e.src
       JOIN graph_rank rr ON rr.node = e.src AND rr.slot = ${slot}
       WHERE e.rowid > ${lo} AND e.rowid <= ${hi} AND n.outsum > 0 AND rr.r <> 0
       GROUP BY e.dst
       ON CONFLICT(node) DO UPDATE SET v = graph_inflow.v + excluded.v`,
  );
  const apply = `UPDATE graph_rank AS g SET rn = g.rn + ${alpha} * f.v
       FROM graph_inflow AS f WHERE g.slot = ${slot} AND g.node = f.node`;
  const commit = `UPDATE graph_rank SET r = rn WHERE slot = ${slot}`;
  return [reset, `DELETE FROM graph_inflow`, ...inflowChunks, apply, commit];
}

/** Write graph_rank -> the signals tables. trust = MIN over the k trust slots; distrust = the reverse slot. */
export function finalizeStatements(): string[] {
  const trustSlots = Array.from({ length: K }, (_, i) => i).join(",");
  return [
    `UPDATE address_signals SET graph_trust = 0, graph_distrust = 0`,
    `UPDATE address_signals AS a SET graph_trust = m.tr
       FROM (SELECT node, MIN(r) AS tr FROM graph_rank WHERE slot IN (${trustSlots}) GROUP BY node) m
       WHERE a.address = m.node`,
    `UPDATE address_signals AS a SET graph_distrust = m.dr
       FROM (SELECT node, r AS dr FROM graph_rank WHERE slot = ${DISTRUST_SLOT}) m
       WHERE a.address = m.node`,
    `UPDATE asset_signals SET graph_trust = 0, graph_distrust = 0`,
    `UPDATE asset_signals AS a SET graph_trust = m.tr
       FROM (SELECT substr(node, ${ASSET_PREFIX.length + 1}) AS asset, MIN(r) AS tr FROM graph_rank
             WHERE slot IN (${trustSlots}) AND node LIKE '${ASSET_PREFIX}%' GROUP BY node) m
       WHERE a.asset = m.asset`,
    `UPDATE asset_signals AS a SET graph_distrust = m.dr
       FROM (SELECT substr(node, ${ASSET_PREFIX.length + 1}) AS asset, r AS dr FROM graph_rank
             WHERE slot = ${DISTRUST_SLOT} AND node LIKE '${ASSET_PREFIX}%') m
       WHERE a.asset = m.asset`,
    // SEEDS ARE AXIOMS, not inferences: a seed teleports in only ONE of the k subsets, so its component-wise
    // MIN is its weakest non-seeded slot (the first prod run graded RAREPEPE ~p90 while non-seed assets of
    // all-subset-trusted issuers scored 300x higher). Seed nodes take MAX over the trust slots instead.
    `UPDATE address_signals AS a SET graph_trust = m.tr
       FROM (SELECT r.node, MAX(r.r) AS tr FROM graph_rank r
             JOIN graph_seed sd ON sd.node = r.node AND sd.slot < ${K}
             WHERE r.slot IN (${trustSlots}) GROUP BY r.node) m
       WHERE a.address = m.node`,
    `UPDATE asset_signals AS a SET graph_trust = m.tr
       FROM (SELECT substr(r.node, ${ASSET_PREFIX.length + 1}) AS asset, MAX(r.r) AS tr FROM graph_rank r
             JOIN graph_seed sd ON sd.node = r.node AND sd.slot < ${K}
             WHERE r.slot IN (${trustSlots}) AND r.node LIKE '${ASSET_PREFIX}%' GROUP BY r.node) m
       WHERE a.asset = m.asset`,
    // A curated low-quality asset can NEVER read as trusted — zero its trust after all trust writes (it keeps
    // its distrust; it's a distrust seed). The −6 quality penalty under-demotes on the Phase-B scale, so this
    // is the hard backstop: flagged junk is a trust sink, no matter what flowed into it during iteration.
    `UPDATE asset_signals SET graph_trust = 0 WHERE low_quality = 1`,
    // Data-driven tier cuts = a percentile of the positive mass per table/direction (read-layer graphTier
    // cuts), recomputed every rebuild so the tier keeps meaning as the graph evolves. TRUST uses p90; DISTRUST
    // uses p98 — the distrust distribution is bimodal (a huge trace-association spike ~10⁻⁵ + a real tail
    // ~10⁻⁴⁺), so p90 landed IN the spike and labelled ~11k assets on faint evidence. p98 clears the spike so
    // 'distrusted' means CONFIDENTLY bad (~a few hundred, recall of the curated bad set is unaffected — they're
    // the strongest distrust). Self-adjusting percentile > an absolute floor (the value rescales per rebuild).
    ...[
      ["graph_cut_addr_trust", "address_signals", "graph_trust", 0.9],
      ["graph_cut_addr_distrust", "address_signals", "graph_distrust", 0.98],
      ["graph_cut_asset_trust", "asset_signals", "graph_trust", 0.9],
      ["graph_cut_asset_distrust", "asset_signals", "graph_distrust", 0.98],
    ].map(
      ([key, table, col, pct]) =>
        `INSERT INTO indexer_state (key, value)
       VALUES ('${key}', COALESCE((SELECT CAST(${col} AS TEXT) FROM ${table} WHERE ${col} > 0
                ORDER BY ${col} LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * ${pct} AS INT) FROM ${table} WHERE ${col} > 0)), '0'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
  ];
}

// ---- edge / node / rank construction SQL (prod uses these; the harness reuses NODE/RANK/SEED verbatim) ----

// D1 bounds each storage operation (~30s): the full-table GROUP BY aggregations exceeded it on prod
// (first build attempt died on the 1.75M-row sends aggregation). So the money-flow edges are built as
// CHUNKED count-accumulations — block_index windows, raw COUNT(*) upserted via ON CONFLICT on the
// unique (src,dst) index (migration 0025) — then log-normalized (w -> LN(1+w)) in rowid-chunked passes.
// Constant-weight issuer edges are inserted AFTER the normalize so they are never double-transformed.
// The holder<->asset bipartite edges (~6M rows from balances) are DEFERRED in v1: multi-grail holders
// already enter as DIRECT seeds, so the grail->holder flow is seeded rather than propagated; revisit
// as an experiment once v1 is validated on prod data.
const BLOCK_CHUNK = 100_000;
const BLOCK_MAX = 1_200_000; // grid headroom over the current ~957k tip; empty windows are no-ops
const blockWindows: Array<[number, number]> = [];
for (let lo = 0; lo < BLOCK_MAX; lo += BLOCK_CHUNK) blockWindows.push([lo, lo + BLOCK_CHUNK]);
const ROWID_CHUNK = 400_000; // halved after bipartite passes exceeded D1 per-op limits as rank vectors densified
const ROWID_MAX = 8_000_000; // grid covers both variants // ≥ worst-case accumulated edge rows
const rowidWindows: Array<[number, number]> = [];
for (let lo = 0; lo < ROWID_MAX; lo += ROWID_CHUNK) rowidWindows.push([lo, lo + ROWID_CHUNK]);

// edge_block (most-recent interaction block per pair) is captured for a possible future epoch-layered temporal
// pass; the cheap recency-decay that consumed it was measured to do nothing and removed (see the normalize step).

// Accumulate raw counts + the most-recent interaction block for one (src,dst) SELECT core within a block
// window. The SELECT cores all end in WHERE/GROUP BY, so the upsert clause is unambiguous without the
// `WHERE true` trick. edge_block keeps the MAX across accumulated windows (the freshest vouch wins).
const countEdges = (selectCore: (lo: number, hi: number) => string) =>
  blockWindows.map(
    ([lo, hi]) =>
      `INSERT INTO graph_edges (src, dst, w, edge_block) ${selectCore(lo, hi)}
     ON CONFLICT(src, dst) DO UPDATE SET w = graph_edges.w + excluded.w, edge_block = MAX(graph_edges.edge_block, excluded.edge_block)`,
  );

export const EDGE_INSERTS: string[] = [
  // sends: the source endorses the destination (a payment is a weak vouch). Plain sends are already keyed
  // to the human operator (source) — the origin remap only matters on the dispenser rail below. A creator
  // funding their OWN empty-address dispenser is machine maintenance, not a vouch — dropped (else every
  // trusted creator sprinkles trust over dozens of dead vending-machine addresses).
  ...countEdges(
    (lo, hi) =>
      `SELECT source, destination, COUNT(*), MAX(block_index) FROM sends s
     WHERE block_index > ${lo} AND block_index <= ${hi}
       AND source IS NOT NULL AND destination IS NOT NULL AND source <> destination
       AND source NOT IN ${EXCLUDE_SRC}
       AND NOT EXISTS (SELECT 1 FROM dispensers dp WHERE dp.source = s.destination AND dp.origin = s.source)
     GROUP BY source, destination`,
  ),
  // order_matches: a trade is a mutual interaction -> an edge each way.
  ...countEdges(
    (lo, hi) =>
      `SELECT tx0_address, tx1_address, COUNT(*), MAX(block_index) FROM order_matches
     WHERE block_index > ${lo} AND block_index <= ${hi}
       AND tx0_address IS NOT NULL AND tx1_address IS NOT NULL AND tx0_address <> tx1_address
       AND tx0_address NOT IN ${EXCLUDE_SRC}
     GROUP BY tx0_address, tx1_address`,
  ),
  ...countEdges(
    (lo, hi) =>
      `SELECT tx1_address, tx0_address, COUNT(*), MAX(block_index) FROM order_matches
     WHERE block_index > ${lo} AND block_index <= ${hi}
       AND tx0_address IS NOT NULL AND tx1_address IS NOT NULL AND tx0_address <> tx1_address
       AND tx1_address NOT IN ${EXCLUDE_SRC}
     GROUP BY tx1_address, tx0_address`,
  ),
  // dispenses: the BUYER (destination) endorses the CREATOR, origin-aware (COALESCE(dispensers.origin,
  // dispenses.source)) so a creator dispensing from a throwaway empty address is credited to the operator.
  ...countEdges(
    (lo, hi) =>
      `SELECT d.destination, COALESCE(dp.origin, d.source), COUNT(*), MAX(d.block_index)
     FROM dispenses d LEFT JOIN dispensers dp ON dp.tx_hash = d.dispenser_tx_hash
     WHERE d.block_index > ${lo} AND d.block_index <= ${hi}
       AND d.destination IS NOT NULL AND COALESCE(dp.origin, d.source) IS NOT NULL
       AND d.destination <> COALESCE(dp.origin, d.source)
       AND d.destination NOT IN ${EXCLUDE_SRC}
     GROUP BY d.destination, COALESCE(dp.origin, d.source)`,
  ),
  // normalize accumulated counts -> ln(1+count), rowid-chunked. (Recency-DECAY of edge weight was tried and
  // REJECTED via the scorecard — Phase D Option 1: degree-normalized PPR is scale-invariant to uniform edge
  // decay, so it moved nothing. edge_block is still captured above in case the epoch-layered Option 3 is ever
  // built; it just isn't consumed here.)
  ...rowidWindows.map(([lo, hi]) => `UPDATE graph_edges SET w = LN(1 + w) WHERE rowid > ${lo} AND rowid <= ${hi}`),
  // bipartite asset -> issuer (a grail flows to whoever issued it). Constant weight; post-normalize.
  `INSERT INTO graph_edges (src, dst, w)
   SELECT '${ASSET_PREFIX}' || asset, issuer, ${BIP_W} FROM assets WHERE issuer IS NOT NULL
   ON CONFLICT(src, dst) DO NOTHING`,
  // bipartite issuer -> asset (a trusted issuer flows to their catalog — how address seeds reach assets).
  `INSERT INTO graph_edges (src, dst, w)
   SELECT issuer, '${ASSET_PREFIX}' || asset, ${BIP_W} FROM assets
   WHERE issuer IS NOT NULL AND issuer NOT IN ${EXCLUDE_SRC}
   ON CONFLICT(src, dst) DO NOTHING`,
];

// EXPERIMENT (opt-in via /admin/build-graph?bipartite=1): the deferred holder<->asset edges — the
// doc's "grail -> holders -> their holdings" flow as PROPAGATION rather than seeding. balances is one
// row per (holder, asset), so no GROUP BY is needed; chunked by rowid for the D1 op limits. Constant
// weight, post-normalize, DO NOTHING on conflict (a pair can't repeat within balances).
const BAL_CHUNK = 250_000;
const BAL_MAX = 4_000_000; // headroom over ~1.85M balance rows
const balWindows: Array<[number, number]> = [];
for (let lo = 0; lo < BAL_MAX; lo += BAL_CHUNK) balWindows.push([lo, lo + BAL_CHUNK]);
export const BIPARTITE_EDGE_INSERTS: string[] = [
  // holder -> asset (a trusted holder's demand reaches the asset).
  ...balWindows.map(
    ([lo, hi]) =>
      `INSERT INTO graph_edges (src, dst, w)
     SELECT b.holder, '${ASSET_PREFIX}' || b.asset, ${BIP_W} FROM balances b
     WHERE b.rowid > ${lo} AND b.rowid <= ${hi}
       AND b.holder_type = 'address' AND CAST(b.quantity AS INTEGER) > 0 AND b.holder IS NOT NULL
       AND b.holder NOT IN ${EXCLUDE_SRC}
     ON CONFLICT(src, dst) DO NOTHING`,
  ),
  // asset -> holder (a grail seed flows to its holders -> what those holders hold).
  ...balWindows.map(
    ([lo, hi]) =>
      `INSERT INTO graph_edges (src, dst, w)
     SELECT '${ASSET_PREFIX}' || b.asset, b.holder, ${BIP_W} FROM balances b
     WHERE b.rowid > ${lo} AND b.rowid <= ${hi}
       AND b.holder_type = 'address' AND CAST(b.quantity AS INTEGER) > 0 AND b.holder IS NOT NULL
     ON CONFLICT(src, dst) DO NOTHING`,
  ),
];

// NB: the `WHERE true` before ON CONFLICT disambiguates the upsert clause from a join constraint — required by
// SQLite (all versions, D1 included) whenever an INSERT...SELECT carries an ON CONFLICT.
export const NODE_INSERTS: string[] = [
  `INSERT INTO graph_node (id, outsum) SELECT src, SUM(w) FROM graph_edges WHERE true GROUP BY src
     ON CONFLICT(id) DO UPDATE SET outsum = excluded.outsum`,
  `INSERT INTO graph_node (id, insum) SELECT dst, SUM(w) FROM graph_edges WHERE true GROUP BY dst
     ON CONFLICT(id) DO UPDATE SET insum = excluded.insum`,
];

// one rank row per (node, slot) for every node with an edge; seeds get their teleport set later. Isolated
// nodes (no edges) get NO row -> they read back as trust=0/distrust=0 = unscored (the newcomer default).
export const RANK_INIT: string[] = Array.from(
  { length: K + 1 },
  (_, slot) =>
    `INSERT INTO graph_rank (node, slot, s, r, rn) SELECT id, ${slot}, 0, 0, 0 FROM graph_node
     WHERE true ON CONFLICT(node, slot) DO NOTHING`,
);

// join the computed teleport vectors into graph_rank and START the iteration from the teleport (r = s).
export const SEED_APPLY = `UPDATE graph_rank AS g SET s = sd.s, r = sd.s
  FROM graph_seed sd WHERE g.node = sd.node AND g.slot = sd.slot`;

// ---- normalized entity graph ---------------------------------------------------------------
// The compact graph stores both addresses and assets as entity_dictionary rows and builds a new generation
// beside the live one. These builders are the final storage form; the text-node SQL above remains only until
// the source-DB graph reader is cut over after the first compact generation is verified.
const ENTITY_CHUNK = 50_000;
const ENTITY_MAX = 1_000_000;
const entityWindows: Array<[number, number]> = [];
for (let lo = 0; lo < ENTITY_MAX; lo += ENTITY_CHUNK) entityWindows.push([lo, lo + ENTITY_CHUNK]);

export function entityPassStatements(generation: number, slot: number, reverse: boolean, alpha = ALPHA): string[] {
  const tele = 1 - alpha;
  const chunks = entityWindows.map(([lo, hi]) =>
    reverse
      ? `INSERT INTO graph_inflow(generation,entity_id,value)
         SELECT ${generation},edge.source_entity_id,
                SUM(edge.weight/node.insum*rank.rank)
         FROM graph_edges edge
         JOIN graph_node node ON node.generation=${generation}
           AND node.entity_id=edge.destination_entity_id
         JOIN graph_rank rank ON rank.generation=${generation}
           AND rank.entity_id=edge.destination_entity_id AND rank.slot=${slot}
         WHERE edge.generation=${generation}
           AND edge.destination_entity_id>${lo} AND edge.destination_entity_id<=${hi}
           AND node.insum>0 AND rank.rank<>0
         GROUP BY edge.source_entity_id
         ON CONFLICT(generation,entity_id) DO UPDATE SET value=graph_inflow.value+excluded.value`
      : `INSERT INTO graph_inflow(generation,entity_id,value)
         SELECT ${generation},edge.destination_entity_id,
                SUM(edge.weight/node.outsum*rank.rank)
         FROM graph_edges edge
         JOIN graph_node node ON node.generation=${generation}
           AND node.entity_id=edge.source_entity_id
         JOIN graph_rank rank ON rank.generation=${generation}
           AND rank.entity_id=edge.source_entity_id AND rank.slot=${slot}
         WHERE edge.generation=${generation}
           AND edge.source_entity_id>${lo} AND edge.source_entity_id<=${hi}
           AND node.outsum>0 AND rank.rank<>0
         GROUP BY edge.destination_entity_id
         ON CONFLICT(generation,entity_id) DO UPDATE SET value=graph_inflow.value+excluded.value`,
  );
  return [
    `UPDATE graph_rank SET normalized_rank=${tele}*score WHERE generation=${generation} AND slot=${slot}`,
    `DELETE FROM graph_inflow WHERE generation=${generation}`,
    ...chunks,
    `UPDATE graph_rank AS rank SET normalized_rank=rank.normalized_rank+${alpha}*inflow.value
     FROM graph_inflow inflow WHERE rank.generation=${generation} AND rank.slot=${slot}
       AND inflow.generation=${generation} AND inflow.entity_id=rank.entity_id`,
    `UPDATE graph_rank SET rank=normalized_rank WHERE generation=${generation} AND slot=${slot}`,
  ];
}

export function entityNodeStatements(generation: number): string[] {
  return [
    `INSERT INTO graph_node(generation,entity_id,outsum)
     SELECT ${generation},source_entity_id,SUM(weight) FROM graph_edges
     WHERE generation=${generation} GROUP BY source_entity_id
     ON CONFLICT(generation,entity_id) DO UPDATE SET outsum=excluded.outsum`,
    `INSERT INTO graph_node(generation,entity_id,insum)
     SELECT ${generation},destination_entity_id,SUM(weight) FROM graph_edges
     WHERE generation=${generation} GROUP BY destination_entity_id
     ON CONFLICT(generation,entity_id) DO UPDATE SET insum=excluded.insum`,
  ];
}

export function entityRankInitStatements(generation: number): string[] {
  return Array.from(
    { length: K + 1 },
    (_, slot) =>
      `INSERT INTO graph_rank(generation,entity_id,slot,score,rank,normalized_rank)
       SELECT ${generation},entity_id,${slot},0,0,0 FROM graph_node WHERE generation=${generation}
       ON CONFLICT(generation,entity_id,slot) DO NOTHING`,
  );
}

export function entitySeedApplyStatement(generation: number): string {
  return `UPDATE graph_rank AS rank SET score=seed.score,rank=seed.score
          FROM graph_seed seed WHERE rank.generation=${generation} AND seed.generation=${generation}
            AND rank.entity_id=seed.entity_id AND rank.slot=seed.slot`;
}

export function entityFinalizeStatements(generation: number): string[] {
  const trustSlots = Array.from({ length: K }, (_, index) => index).join(",");
  const cuts: Array<[string, string, string, number]> = [
    ["graph_cut_addr_trust", "address_signals", "graph_trust", 0.9],
    ["graph_cut_addr_distrust", "address_signals", "graph_distrust", 0.98],
    ["graph_cut_asset_trust", "asset_signals", "graph_trust", 0.9],
    ["graph_cut_asset_distrust", "asset_signals", "graph_distrust", 0.98],
  ];
  return [
    `UPDATE address_signals SET graph_trust=0,graph_distrust=0`,
    `UPDATE address_signals AS signal SET graph_trust=score.value FROM (
       SELECT address.address_id,MIN(rank.rank) value FROM graph_rank rank
       JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id AND entity.entity_type='address'
       JOIN address_dictionary address ON address.address=entity.entity_key
       WHERE rank.generation=${generation} AND rank.slot IN (${trustSlots}) GROUP BY rank.entity_id
     ) score WHERE score.address_id=signal.address_id`,
    `UPDATE address_signals AS signal SET graph_distrust=score.value FROM (
       SELECT address.address_id,rank.rank value FROM graph_rank rank
       JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id AND entity.entity_type='address'
       JOIN address_dictionary address ON address.address=entity.entity_key
       WHERE rank.generation=${generation} AND rank.slot=${DISTRUST_SLOT}
     ) score WHERE score.address_id=signal.address_id`,
    `UPDATE asset_signals SET graph_trust=0,graph_distrust=0`,
    `UPDATE asset_signals AS signal SET graph_trust=score.value FROM (
       SELECT asset.asset_id,MIN(rank.rank) value FROM graph_rank rank
       JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id AND entity.entity_type='asset'
       JOIN asset_dictionary asset ON asset.asset=entity.entity_key
       WHERE rank.generation=${generation} AND rank.slot IN (${trustSlots}) GROUP BY rank.entity_id
     ) score WHERE score.asset_id=signal.asset_id`,
    `UPDATE asset_signals AS signal SET graph_distrust=score.value FROM (
       SELECT asset.asset_id,rank.rank value FROM graph_rank rank
       JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id AND entity.entity_type='asset'
       JOIN asset_dictionary asset ON asset.asset=entity.entity_key
       WHERE rank.generation=${generation} AND rank.slot=${DISTRUST_SLOT}
     ) score WHERE score.asset_id=signal.asset_id`,
    `UPDATE address_signals AS signal SET graph_trust=score.value FROM (
       SELECT address.address_id,MAX(rank.rank) value FROM graph_rank rank
       JOIN graph_seed seed ON seed.generation=${generation} AND seed.entity_id=rank.entity_id AND seed.slot<${K}
       JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id AND entity.entity_type='address'
       JOIN address_dictionary address ON address.address=entity.entity_key
       WHERE rank.generation=${generation} AND rank.slot IN (${trustSlots}) GROUP BY rank.entity_id
     ) score WHERE score.address_id=signal.address_id`,
    `UPDATE asset_signals AS signal SET graph_trust=score.value FROM (
       SELECT asset.asset_id,MAX(rank.rank) value FROM graph_rank rank
       JOIN graph_seed seed ON seed.generation=${generation} AND seed.entity_id=rank.entity_id AND seed.slot<${K}
       JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id AND entity.entity_type='asset'
       JOIN asset_dictionary asset ON asset.asset=entity.entity_key
       WHERE rank.generation=${generation} AND rank.slot IN (${trustSlots}) GROUP BY rank.entity_id
     ) score WHERE score.asset_id=signal.asset_id`,
    `UPDATE asset_signals SET graph_trust=0 WHERE low_quality=1`,
    ...cuts.map(
      ([key, table, column, percentile]) =>
        `INSERT INTO core_state(key,value) VALUES('${key}',COALESCE((
           SELECT CAST(${column} AS TEXT) FROM ${table} WHERE ${column}>0 ORDER BY ${column}
           LIMIT 1 OFFSET (SELECT CAST(COUNT(*)*${percentile} AS INT) FROM ${table} WHERE ${column}>0)
         ),'0')) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ),
    `INSERT INTO core_state(key,value) VALUES('graph_generation','${generation}')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ];
}
