import type { AssetActivityOutlook } from "@xcp/shared/assets";

interface ActivityOutlookRow {
  active_trade_months: number;
  activity_outlook_score: number | null;
  activity_outlook_rank: number | null;
  activity_outlook_population: number | null;
  activity_outlook_calculated_at: number | null;
}

/** Validate the stored projection at the wire boundary, including stale rows left behind by a reorg. */
export function assetActivityOutlook(row: ActivityOutlookRow | null): AssetActivityOutlook | null {
  if (!row || row.active_trade_months <= 0) return null;
  const { activity_outlook_score: score, activity_outlook_rank: rank } = row;
  const population = row.activity_outlook_population;
  const calculatedAt = row.activity_outlook_calculated_at;
  if (
    score == null ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100 ||
    rank == null ||
    !Number.isInteger(rank) ||
    population == null ||
    !Number.isInteger(population) ||
    rank < 1 ||
    rank > population ||
    calculatedAt == null ||
    !Number.isInteger(calculatedAt) ||
    calculatedAt <= 0
  )
    return null;
  return {
    score: Math.round(score * 10) / 10,
    rank,
    population,
    horizon_days: 180,
    calculated_at: calculatedAt,
  };
}
