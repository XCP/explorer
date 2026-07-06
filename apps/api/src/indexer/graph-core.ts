/**
 * Graph-reputation trait — the Env-free CORE (pure functions + SQL string builders). Split out from graph.ts
 * so the validation harness (tests/graph.test.ts) and the read layer can import the iteration/finalize/tier
 * logic WITHOUT pulling in the Worker Env (which transitively drags the whole read router into the test
 * compile). See graph.ts for the bounded job that drives these against D1, and docs/graph-reputation.md.
 */

// ---- tuning constants ----
export const ALPHA = 0.85;      // PPR damping (the doc's value; convergence depends on this, not graph size)
export const PASSES = 20;       // power-iteration passes per slot (stable ordering by ~20 per the doc)
export const K = 3;             // trust seed subsets (Min-k). slots 0..K-1 = trust, slot K = distrust
export const DISTRUST_SLOT = K; // slot 3
export const ASSET_PREFIX = "asset:"; // asset node id namespace so an asset never collides with a bitcoin address
export const BIP_W = "0.6931471805599453"; // ln(2): the constant bipartite edge weight (count is always 1 per pair)

// curated conduits (exchanges + burns) excluded as trust SOURCES — subquery reused in every edge insert.
export const EXCLUDE_SRC = `(SELECT key FROM curated WHERE kind IN ('exchange','burn'))`;

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
export function graphTier(trust: number, distrust: number): GraphTier {
  const t = trust > 0 ? trust : 0;
  const d = distrust > 0 ? distrust : 0;
  if (t <= 0 && d <= 0) return "unscored";
  return d > t ? "distrusted" : "trusted";
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
  const inflow = reverse
    ? `UPDATE graph_rank AS g SET rn = g.rn + ${alpha} * f.inflow
       FROM (SELECT e.src AS node, SUM(e.w / n.insum * rr.r) AS inflow
             FROM graph_edges e
             JOIN graph_node n ON n.id = e.dst
             JOIN graph_rank rr ON rr.node = e.dst AND rr.slot = ${slot}
             WHERE n.insum > 0 AND rr.r <> 0
             GROUP BY e.src) AS f
       WHERE g.slot = ${slot} AND g.node = f.node`
    : `UPDATE graph_rank AS g SET rn = g.rn + ${alpha} * f.inflow
       FROM (SELECT e.dst AS node, SUM(e.w / n.outsum * rr.r) AS inflow
             FROM graph_edges e
             JOIN graph_node n ON n.id = e.src
             JOIN graph_rank rr ON rr.node = e.src AND rr.slot = ${slot}
             WHERE n.outsum > 0 AND rr.r <> 0
             GROUP BY e.dst) AS f
       WHERE g.slot = ${slot} AND g.node = f.node`;
  const commit = `UPDATE graph_rank SET r = rn WHERE slot = ${slot}`;
  return [reset, inflow, commit];
}

/** Write graph_rank -> the signals tables. trust = MIN over the k trust slots; distrust = the reverse slot. */
export function finalizeStatements(): string[] {
  const trustSlots = Array.from({ length: K }, (_, i) => i).join(",");
  return [
    `UPDATE address_signals SET graph_trust = 0, graph_distrust = 0`,
    `UPDATE address_signals AS a SET graph_trust = m.tr
       FROM (SELECT node, MIN(r) AS tr FROM graph_rank WHERE slot IN (${trustSlots}) GROUP BY node) m
       WHERE a.addr = m.node`,
    `UPDATE address_signals AS a SET graph_distrust = m.dr
       FROM (SELECT node, r AS dr FROM graph_rank WHERE slot = ${DISTRUST_SLOT}) m
       WHERE a.addr = m.node`,
    `UPDATE asset_signals SET graph_trust = 0, graph_distrust = 0`,
    `UPDATE asset_signals AS a SET graph_trust = m.tr
       FROM (SELECT substr(node, ${ASSET_PREFIX.length + 1}) AS asset, MIN(r) AS tr FROM graph_rank
             WHERE slot IN (${trustSlots}) AND node LIKE '${ASSET_PREFIX}%' GROUP BY node) m
       WHERE a.asset = m.asset`,
    `UPDATE asset_signals AS a SET graph_distrust = m.dr
       FROM (SELECT substr(node, ${ASSET_PREFIX.length + 1}) AS asset, r AS dr FROM graph_rank
             WHERE slot = ${DISTRUST_SLOT} AND node LIKE '${ASSET_PREFIX}%') m
       WHERE a.asset = m.asset`,
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
const ROWID_CHUNK = 1_000_000;
const ROWID_MAX = 8_000_000; // ≥ worst-case accumulated edge rows
const rowidWindows: Array<[number, number]> = [];
for (let lo = 0; lo < ROWID_MAX; lo += ROWID_CHUNK) rowidWindows.push([lo, lo + ROWID_CHUNK]);

// Accumulate raw counts for one (src,dst) SELECT core within a block window. The SELECT cores all end
// in WHERE/GROUP BY, so the upsert clause is unambiguous without the `WHERE true` trick (which is only
// needed when a bare SELECT could parse its ON as a join constraint).
const countEdges = (selectCore: (lo: number, hi: number) => string) =>
  blockWindows.map(([lo, hi]) =>
    `INSERT INTO graph_edges (src, dst, w) ${selectCore(lo, hi)}
     ON CONFLICT(src, dst) DO UPDATE SET w = graph_edges.w + excluded.w`);

export const EDGE_INSERTS: string[] = [
  // sends: the source endorses the destination (a payment is a weak vouch). Plain sends are already keyed
  // to the human operator (source) — the origin remap only matters on the dispenser rail below.
  ...countEdges((lo, hi) =>
    `SELECT source, destination, COUNT(*) FROM sends
     WHERE block_index > ${lo} AND block_index <= ${hi}
       AND source IS NOT NULL AND destination IS NOT NULL AND source <> destination
       AND source NOT IN ${EXCLUDE_SRC}
     GROUP BY source, destination`),
  // order_matches: a trade is a mutual interaction -> an edge each way.
  ...countEdges((lo, hi) =>
    `SELECT tx0_address, tx1_address, COUNT(*) FROM order_matches
     WHERE block_index > ${lo} AND block_index <= ${hi}
       AND tx0_address IS NOT NULL AND tx1_address IS NOT NULL AND tx0_address <> tx1_address
       AND tx0_address NOT IN ${EXCLUDE_SRC}
     GROUP BY tx0_address, tx1_address`),
  ...countEdges((lo, hi) =>
    `SELECT tx1_address, tx0_address, COUNT(*) FROM order_matches
     WHERE block_index > ${lo} AND block_index <= ${hi}
       AND tx0_address IS NOT NULL AND tx1_address IS NOT NULL AND tx0_address <> tx1_address
       AND tx1_address NOT IN ${EXCLUDE_SRC}
     GROUP BY tx1_address, tx0_address`),
  // dispenses: the BUYER (destination) endorses the CREATOR, origin-aware (COALESCE(dispensers.origin,
  // dispenses.source)) so a creator dispensing from a throwaway empty address is credited to the operator.
  ...countEdges((lo, hi) =>
    `SELECT d.destination, COALESCE(dp.origin, d.source), COUNT(*)
     FROM dispenses d LEFT JOIN dispensers dp ON dp.tx_hash = d.dispenser_tx_hash
     WHERE d.block_index > ${lo} AND d.block_index <= ${hi}
       AND d.destination IS NOT NULL AND COALESCE(dp.origin, d.source) IS NOT NULL
       AND d.destination <> COALESCE(dp.origin, d.source)
       AND d.destination NOT IN ${EXCLUDE_SRC}
     GROUP BY d.destination, COALESCE(dp.origin, d.source)`),
  // normalize accumulated counts -> ln(1+count), rowid-chunked (all rows so far are count edges).
  ...rowidWindows.map(([lo, hi]) =>
    `UPDATE graph_edges SET w = LN(1 + w) WHERE rowid > ${lo} AND rowid <= ${hi}`),
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
export const RANK_INIT: string[] = Array.from({ length: K + 1 }, (_, slot) =>
  `INSERT INTO graph_rank (node, slot, s, r, rn) SELECT id, ${slot}, 0, 0, 0 FROM graph_node
     WHERE true ON CONFLICT(node, slot) DO NOTHING`);

// join the computed teleport vectors into graph_rank and START the iteration from the teleport (r = s).
export const SEED_APPLY = `UPDATE graph_rank AS g SET s = sd.s, r = sd.s
  FROM graph_seed sd WHERE g.node = sd.node AND g.slot = sd.slot`;
