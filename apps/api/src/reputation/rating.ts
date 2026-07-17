import type { AssetRating } from "@xcp/shared/assets";
import type { AssetSignalsRow } from "#api/storage-types";

const finite = (value: number | null): value is number => value != null && Number.isFinite(value);

/** Convert the stored projection into the one public Rating contract. */
export function assetRating(row: AssetSignalsRow | null): AssetRating {
  if (!row) return { status: "not_rated", rating: null };
  if (row.low_quality === 1) return { status: "integrity_flag", rating: null };
  if (
    !finite(row.rating_value) ||
    row.rating_value < 0 ||
    row.rating_value > 10 ||
    row.rating_rank == null ||
    row.rating_population == null ||
    row.rating_rank < 1 ||
    row.rating_rank > row.rating_population ||
    !finite(row.rating_active_months_score) ||
    !finite(row.rating_buyer_breadth_score) ||
    !finite(row.rating_realized_value_score) ||
    row.rating_calculated_at == null ||
    row.rating_calculated_at <= 0 ||
    row.rating_model_version == null ||
    row.rating_model_version <= 0
  )
    return { status: "not_rated", rating: null };
  return {
    status: "rated",
    rating: Math.round(row.rating_value * 10) / 10,
    rank: row.rating_rank,
    population: row.rating_population,
    calculated_at: row.rating_calculated_at,
    model_version: row.rating_model_version,
    evidence: {
      active_months: row.clean_active_trade_months,
      independent_buyers: row.distinct_paid_buyers,
      realized_usd: Math.round(row.clean_realized_usd * 100) / 100,
    },
    components: {
      active_months: Math.round(row.rating_active_months_score * 10) / 10,
      buyer_breadth: Math.round(row.rating_buyer_breadth_score * 10) / 10,
      realized_value: Math.round(row.rating_realized_value_score * 10) / 10,
    },
  };
}
