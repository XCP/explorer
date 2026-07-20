export const GRAPH_ALPHA = 0.85;
export const GRAPH_PASSES = 20;
export const GRAPH_K = 3;

export function validationFold(key, folds = 5) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % folds;
}

/** @param {{weight:number,edge_block:number|null}} edge @param {number} tip @param {number|null} halfLifeBlocks */
export function edgeWeight(edge, tip, halfLifeBlocks = null) {
  const weight = Number(edge.weight);
  if (!halfLifeBlocks || edge.edge_block == null) return weight;
  const age = Math.max(0, tip - Number(edge.edge_block));
  return weight * 2 ** (-age / halfLifeBlocks);
}

function ppr(edges, maxNode, seedIds, reverse, tip, halfLifeBlocks) {
  let rank = new Float64Array(maxNode + 1);
  const seed = new Float64Array(maxNode + 1);
  const degree = new Float64Array(maxNode + 1);
  if (seedIds.length) for (const id of seedIds) seed[id] = 1 / seedIds.length;
  for (const edge of edges) {
    const weight = edgeWeight(edge, tip, halfLifeBlocks);
    degree[reverse ? edge.destination : edge.source] += weight;
  }
  rank.set(seed);
  for (let pass = 0; pass < GRAPH_PASSES; pass++) {
    const next = new Float64Array(maxNode + 1);
    for (const id of seedIds) next[id] = (1 - GRAPH_ALPHA) * seed[id];
    for (const edge of edges) {
      const from = reverse ? edge.destination : edge.source;
      const to = reverse ? edge.source : edge.destination;
      if (rank[from] && degree[from])
        next[to] += GRAPH_ALPHA * edgeWeight(edge, tip, halfLifeBlocks) * (rank[from] / degree[from]);
    }
    rank = next;
  }
  return rank;
}

function percentileCut(values, percentile) {
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  return positive[Math.min(positive.length - 1, Math.floor(positive.length * percentile))] ?? 0;
}

function labelResult(labels, classify, score) {
  const rows = labels.map((label) => ({
    ...label,
    score: score(label.entity_id),
    detected: classify(label.entity_id),
  }));
  const byType = Object.fromEntries(
    [...new Set(rows.map((row) => row.entity_type))].map((type) => {
      const typed = rows.filter((row) => row.entity_type === type);
      const detected = typed.filter((row) => row.detected).length;
      return [type, { total: typed.length, detected, recall: typed.length ? detected / typed.length : null }];
    }),
  );
  return {
    total: rows.length,
    detected: rows.filter((row) => row.detected).length,
    recall: rows.length ? rows.filter((row) => row.detected).length / rows.length : null,
    zero_score: rows.filter((row) => row.score === 0).length,
    by_entity_type: byType,
    examples_missed: rows
      .filter((row) => !row.detected)
      .slice(0, 20)
      .map(({ key, entity_type, score: value }) => ({
        key,
        entity_type,
        score: value,
      })),
  };
}

export function evaluateHeldoutGraph({ edges, seeds, maxNode, tip, halfLifeBlocks = null, holdoutFold = 0 }) {
  const heldout = seeds.filter(
    (seed) => validationFold(`${seed.entity_type}:${seed.key}:${seed.slot}`) === holdoutFold,
  );
  const training = seeds.filter((seed) => !heldout.includes(seed));
  const trustVectors = Array.from({ length: GRAPH_K }, (_, slot) =>
    ppr(
      edges,
      maxNode,
      training.filter((seed) => seed.slot === slot).map((seed) => seed.entity_id),
      false,
      tip,
      halfLifeBlocks,
    ),
  );
  const distrust = ppr(
    edges,
    maxNode,
    training.filter((seed) => seed.slot === GRAPH_K).map((seed) => seed.entity_id),
    true,
    tip,
    halfLifeBlocks,
  );
  const trust = new Float64Array(maxNode + 1);
  for (let id = 0; id <= maxNode; id++) trust[id] = Math.min(...trustVectors.map((vector) => vector[id]));
  const trustCut = percentileCut([...trust], 0.9);
  const distrustCut = percentileCut([...distrust], 0.98);
  const trustLabels = heldout.filter((seed) => seed.slot < GRAPH_K);
  const distrustLabels = heldout.filter((seed) => seed.slot === GRAPH_K);
  return {
    holdout_fold: holdoutFold,
    variant: halfLifeBlocks ? { temporal_half_life_blocks: halfLifeBlocks } : { temporal_half_life_blocks: null },
    training: {
      trust: training.filter((seed) => seed.slot < GRAPH_K).length,
      distrust: training.length - training.filter((seed) => seed.slot < GRAPH_K).length,
    },
    heldout: { trust: trustLabels.length, distrust: distrustLabels.length },
    cuts: { trust: trustCut, distrust: distrustCut },
    trust: labelResult(
      trustLabels,
      (id) => trust[id] > 0 && trust[id] >= distrust[id] && trust[id] >= trustCut,
      (id) => trust[id],
    ),
    distrust: labelResult(
      distrustLabels,
      (id) => distrust[id] > trust[id] && distrust[id] > distrustCut,
      (id) => distrust[id],
    ),
  };
}
