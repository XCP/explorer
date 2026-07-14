/**
 * Graph-reputation trait: environment-free functions and SQL builders shared by production and tests.
 * so the validation harness (tests/graph.test.ts) and the read layer can import the iteration/finalize/tier
 * logic WITHOUT pulling in the Worker Env (which transitively drags the whole read router into the test
 * compile). See graph.ts for the bounded job that drives these against D1, and docs/graph-reputation.md.
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

export function entitySeedInsertStatement(generation: number, rows: number): string {
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError("graph seed insert requires at least one row");
  return `INSERT INTO graph_seed(generation,entity_id,slot,score)
          SELECT ${generation},entity.entity_id,input.column3,input.column4
          FROM (VALUES ${Array.from({ length: rows }, () => "(?,?,?,?)").join(",")}) input
          JOIN entity_dictionary entity ON entity.entity_type=input.column1 AND entity.entity_key=input.column2
          WHERE true
          ON CONFLICT(generation,entity_id,slot) DO UPDATE SET score=excluded.score`;
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

const ENTITY_EXCLUDED = (addressId: string) => `(
  EXISTS (SELECT 1 FROM address_signals signal WHERE signal.address_id=${addressId}
           AND (signal.is_exchange=1 OR signal.is_burn=1 OR signal.is_deposit=1
                OR signal.is_emblem_vault=1 OR signal.likely_service=1))
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
