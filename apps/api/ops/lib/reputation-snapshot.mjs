import { createHash } from "node:crypto";

export const SNAPSHOT_SCHEMA = "xcp-reputation-snapshot/1";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function percentileRanks(rows, field) {
  const sorted = [...rows].sort((a, b) => Number(a[field]) - Number(b[field]) || Number(a.id) - Number(b.id));
  const ranks = new Map();
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && Number(sorted[end][field]) === Number(sorted[start][field])) end++;
    const percentile = sorted.length <= 1 ? 0 : start / (sorted.length - 1);
    for (let index = start; index < end; index++) ranks.set(sorted[index].id, percentile);
    start = end;
  }
  return ranks;
}

export function evaluateAddressSnapshot(rows) {
  const recency = percentileRanks(rows, "last_transaction_time");
  const activeMonths = percentileRanks(rows, "past_active_months");
  const transactions = percentileRanks(rows, "past_transactions");
  const predictors = {
    recency: (row) => Number(row.last_transaction_time),
    active_months: (row) => Number(row.past_active_months),
    transactions: (row) => Number(row.past_transactions),
    balanced_participation: (row) => (recency.get(row.id) + activeMonths.get(row.id) + transactions.get(row.id)) / 3,
  };
  return Object.entries(predictors).map(([predictor, score]) => evaluateBinaryRanking(rows, predictor, score));
}

export function evaluateBinaryRanking(rows, predictor, score) {
  const ranked = [...rows].sort((a, b) => score(b) - score(a) || Number(a.id) - Number(b.id));
  const positives = ranked.reduce((sum, row) => sum + (Number(row.future_transactions) > 0 ? 1 : 0), 0);
  let seen = 0;
  let averagePrecision = 0;
  let dcg = 0;
  let idealDcg = 0;
  const budgets = [100, 500, Math.max(1, Math.ceil(ranked.length * 0.01))];
  const topDecileSize = Math.ceil(ranked.length / 10);
  const hits = new Map(budgets.map((budget) => [budget, 0]));
  let persistent = 0;
  let topDecilePersistent = 0;
  ranked.forEach((row, index) => {
    const rank = index + 1;
    const returned = Number(row.future_transactions) > 0 ? 1 : 0;
    const isPersistent = Number(row.future_active_months) >= 2 ? 1 : 0;
    seen += returned;
    persistent += isPersistent;
    if (rank <= topDecileSize) topDecilePersistent += isPersistent;
    if (returned) averagePrecision += seen / rank;
    dcg += returned / Math.log2(rank + 1);
    if (rank <= positives) idealDcg += 1 / Math.log2(rank + 1);
    for (const budget of budgets) if (rank <= budget) hits.set(budget, hits.get(budget) + returned);
  });
  const metric = (budget) => ({
    precision: hits.get(budget) / Math.min(budget, ranked.length),
    recall: positives ? hits.get(budget) / positives : 0,
  });
  return {
    predictor,
    eligible: ranked.length,
    positives,
    population_return_rate: positives / ranked.length,
    top_decile_return_rate: seenIn(ranked, topDecileSize, (row) => Number(row.future_transactions) > 0),
    return_lift:
      positives > 0
        ? seenIn(ranked, topDecileSize, (row) => Number(row.future_transactions) > 0) / (positives / ranked.length)
        : 0,
    population_persistent_rate: persistent / ranked.length,
    top_decile_persistent_rate: topDecilePersistent / topDecileSize,
    persistence_lift: persistent > 0 ? topDecilePersistent / topDecileSize / (persistent / ranked.length) : 0,
    at_100: metric(100),
    at_500: metric(500),
    at_1pct: metric(budgets[2]),
    average_precision: positives ? averagePrecision / positives : 0,
    ndcg: idealDcg ? dcg / idealDcg : 0,
  };
}

function seenIn(rows, size, predicate) {
  return rows.slice(0, size).filter(predicate).length / Math.min(size, rows.length);
}

export function snapshotManifest({ cutoff, horizonDays, frontier, chunks, rows }) {
  const canonical = chunks.map(({ name, rows: count, sha256: checksum }) => `${name}:${count}:${checksum}`).join("\n");
  return {
    schema: SNAPSHOT_SCHEMA,
    cutoff,
    horizon_days: horizonDays,
    canonical_frontier: frontier,
    rows,
    chunks,
    content_sha256: sha256(canonical),
  };
}
