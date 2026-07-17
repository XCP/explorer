/** Conviction's small read-time scorer. Asset Rating and Address Reputation are materialized separately. */
import { type Factor, SCALARS, CONVICTION_FACTORS, CONVICTION_PCT } from "#api/reputation/config";
import type { AssetSignalsRow } from "#api/storage-types";

type FeatureRow = Record<string, unknown>;
const num = (value: unknown) => Number(value) || 0;

export interface Scored {
  raw: number;
  breakdown: Record<string, number>;
}

function factorValue(factor: Factor, row: FeatureRow): number {
  if (factor.key === "__circulating_scarcity") {
    const supply = num(row.supply);
    if (supply <= 0) return 0;
    const circulating = Math.max(1, (supply * (100 - num(row.burned_pct))) / 100);
    return SCALARS.scarcityOffset - Math.log10(circulating);
  }
  if (factor.transform === "linear") return num(row[factor.key]) / 100;
  return Math.log1p(Math.max(0, num(row[factor.key])));
}

function sumFactors(factors: Factor[], row: FeatureRow): Scored {
  let raw = 0;
  const breakdown: Record<string, number> = {};
  for (const factor of factors) {
    if (!factor.weight) continue;
    const contribution = factor.weight * factorValue(factor, row);
    raw += contribution;
    breakdown[factor.label] = Math.round(contribution * 100) / 100;
  }
  return { raw, breakdown };
}

type Anchors = { floor: number; p50: number; p90: number; p99: number; max: number };
export function percentile(raw: number, anchors: Anchors): number {
  if (raw <= anchors.floor) return 0;
  if (raw <= anchors.p50) return ((raw - anchors.floor) / (anchors.p50 - anchors.floor)) * 50;
  if (raw <= anchors.p90) return 50 + ((raw - anchors.p50) / (anchors.p90 - anchors.p50)) * 40;
  if (raw <= anchors.p99) return 90 + ((raw - anchors.p90) / (anchors.p99 - anchors.p90)) * 9;
  return Math.min(100, 99 + (raw - anchors.p99) / (anchors.max - anchors.p99));
}

/** Conviction describes holder participation and scarcity without trade-price or realized-value inputs. */
export function scoreConviction(row: Partial<AssetSignalsRow>): Scored {
  if (num((row as FeatureRow).low_quality) === 1) return { raw: 0, breakdown: {} };
  return sumFactors(CONVICTION_FACTORS, row as FeatureRow);
}

export const convictionScore = (raw: number) => Math.round(percentile(raw, CONVICTION_PCT));

/** SQL equivalent for population-level Conviction reads. */
export function rawSqlExpr(factors: Factor[], _tip = 0): string {
  return (
    factors
      .filter((factor) => factor.weight)
      .map((factor) => {
        if (factor.key === "__circulating_scarcity")
          return `${factor.weight}*(CASE WHEN COALESCE(supply,0)<=0 THEN 0 ELSE ${SCALARS.scarcityOffset} - LN(MAX(1.0,COALESCE(supply,0)*(100-COALESCE(burned_pct,0))/100.0))/LN(10) END)`;
        if (factor.transform === "linear") return `${factor.weight}*(COALESCE(${factor.key},0)/100.0)`;
        return `${factor.weight}*LN(1+MAX(0,COALESCE(${factor.key},0)))`;
      })
      .join(" + ") || "0"
  );
}

export { CONVICTION_FACTORS };
