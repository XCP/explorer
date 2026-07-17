/**
 * Generic scorer for Address Reputation and Conviction. Asset Rating is intentionally materialized by
 * indexer/asset-rating.ts and never passes through this factor/tier engine.
 */
import {
  type Factor,
  SCALARS,
  ADDRESS_FACTORS,
  ADDRESS_PCT,
  ADDRESS_TIERS,
  CONVICTION_FACTORS,
  CONVICTION_PCT,
} from "#api/reputation/config";
import type { AssetSignalsRow, AddressSignalsRow } from "#api/storage-types";

// The address reputation row = the stored address_signals row + the two derived columns the scorer reads
// (mirrors queries/addresses.ts AddressReputationRow, defined locally to keep this module import-light).
type AddressScoreRow = AddressSignalsRow & { xcp?: number | null; tip?: number | null };

// The scorer reads feature rows dynamically by factor key, so it treats a row as a bag of numeric-ish columns;
// the public entry points take the concrete signal-row types and pass them through as this shape.
type FeatureRow = Record<string, unknown>;

const num = (v: unknown) => Number(v) || 0;
const ln = (x: number) => Math.log(1 + Math.max(0, x));
// staleness decay multipliers (gentle hyperbolic, floored) — see SCALARS. Applied to legacy time-terms so an
// aged-but-inactive entity decays toward dormant instead of coasting on historical standing.
const addrDecay = (row: FeatureRow, tip: number) =>
  Math.max(
    SCALARS.addrDecayFloor,
    SCALARS.addrDecayHalflife / (SCALARS.addrDecayHalflife + Math.max(0, tip - num(row.last_block))),
  );

/* ---------- single-row scoring (read endpoint) ---------- */

function factorValue(f: Factor, row: FeatureRow, tip: number): number {
  // derived ratios (not stored columns) — computed from the row
  // circulating-scarcity: offset − log10(circulating supply). circulating = supply × (100 − burned_pct)/100
  // (burn-adjusted, so a fully-burned high-issuance asset reads as scarce). Zero/unknown supply → no signal.
  if (f.key === "__circulating_scarcity") {
    const supply = num(row.supply);
    if (supply <= 0) return 0;
    const circ = Math.max(1, (supply * (100 - num(row.burned_pct))) / 100);
    return SCALARS.scarcityOffset - Math.log10(circ);
  }
  switch (f.transform) {
    // address age: decays if idle, then WINSORIZED at SCALARS.addrAgeCap so pure longevity can't dominate (H2 lab).
    case "age":
      return Math.min(SCALARS.addrAgeCap, ((tip - num(row.first_block)) / SCALARS.blockScale) * addrDecay(row, tip));
    case "span":
      return (num(row.last_block) - num(row.first_block)) / SCALARS.blockScale; // __span (address)
    case "linear":
      return num(row[f.key]) / 100;
    default:
      return ln(num(row[f.key])); // "log"
  }
}

export interface Scored {
  raw: number;
  breakdown: Record<string, number>;
}

function sumFactors(factors: Factor[], row: FeatureRow, tip: number): Scored {
  let raw = 0;
  const breakdown: Record<string, number> = {};
  for (const f of factors) {
    if (!f.weight) continue;
    const contrib = f.weight * factorValue(f, row, tip);
    raw += contrib;
    breakdown[f.label] = Math.round(contrib * 100) / 100;
  }
  return { raw, breakdown };
}

export function scoreAddress(row: Partial<AddressScoreRow>, tip: number): Scored {
  const s = sumFactors(ADDRESS_FACTORS, row as unknown as FeatureRow, tip);
  if (num(row.last_block) >= SCALARS.modernActiveBlock) {
    s.raw += SCALARS.modernActiveBonus;
    s.breakdown.modern = SCALARS.modernActiveBonus;
  }
  return s;
}

/* ---------- raw -> 0-100 percentile via piecewise-linear anchors ---------- */
type Anchors = { floor: number; p50: number; p90: number; p99: number; max: number };
export function percentile(raw: number, a: Anchors): number {
  if (raw <= a.floor) return 0;
  if (raw <= a.p50) return ((raw - a.floor) / (a.p50 - a.floor)) * 50;
  if (raw <= a.p90) return 50 + ((raw - a.p50) / (a.p90 - a.p50)) * 40;
  if (raw <= a.p99) return 90 + ((raw - a.p90) / (a.p99 - a.p90)) * 9;
  return Math.min(100, 99 + (raw - a.p99) / (a.max - a.p99));
}
export const addressScore = (raw: number) => Math.round(percentile(raw, ADDRESS_PCT));

/** Conviction describes holder participation and scarcity without trade-price or realized-value inputs. */
export function scoreConviction(row: Partial<AssetSignalsRow>): Scored {
  if (num((row as unknown as FeatureRow).low_quality) === 1) return { raw: 0, breakdown: {} };
  return sumFactors(CONVICTION_FACTORS, row as unknown as FeatureRow, 0);
}
export const convictionScore = (raw: number) => Math.round(percentile(raw, CONVICTION_PCT));
export { CONVICTION_FACTORS };

// Address reputation tier (primary display). Non-ranked states (infra + dormant) return their own label;
// real users are ranked into a tier by raw. Parallel to assetTier.
export type AddrState = "exchange" | "deposit" | "vault" | "burn" | "service" | "dormant" | "ranked";
const ADDR_STATE_LABEL: Record<Exclude<AddrState, "ranked">, string> = {
  exchange: "Exchange",
  deposit: "Exchange deposit",
  vault: "Vault",
  burn: "Burn",
  service: "Service",
  dormant: "Dormant",
};
export function addressTier(raw: number, state: AddrState): string {
  if (state !== "ranked") return ADDR_STATE_LABEL[state];
  for (const t of ADDRESS_TIERS) if (raw >= t.minRaw) return t.tier;
  return "Casual";
}

/* ---------- population SQL (review/calibration) ---------- */
// Builds the raw-score SQL expression over a signals table from the SAME factor list. `tipParam` is a
// literal block height substituted into age terms. xcp (not a signals column) is omitted from the
// population expression — it only shifts the absolute raw, which the anchor recalibration absorbs.
export function rawSqlExpr(factors: Factor[], tip: number): string {
  const terms: string[] = [];
  for (const f of factors) {
    if (!f.weight || f.key === "xcp") continue;
    const w = f.weight,
      B = SCALARS.blockScale;
    const adDk = `MAX(${SCALARS.addrDecayFloor},${SCALARS.addrDecayHalflife}.0/(${SCALARS.addrDecayHalflife}.0+MAX(0,${tip}-COALESCE(last_block,${tip}))))`; // address idle decay
    if (f.key === "__circulating_scarcity")
      terms.push(
        `${w}*(CASE WHEN COALESCE(supply,0)<=0 THEN 0 ELSE ${SCALARS.scarcityOffset} - LN(MAX(1.0,COALESCE(supply,0)*(100-COALESCE(burned_pct,0))/100.0))/LN(10) END)`,
      );
    else if (f.transform === "age")
      terms.push(`${w}*MIN(${SCALARS.addrAgeCap},((${tip}-COALESCE(first_block,${tip}))/${B}.0)*${adDk})`); // age transform winsorized (mirrors score.ts Math.min)
    else if (f.transform === "span") terms.push(`${w}*((COALESCE(last_block,0)-COALESCE(first_block,0))/${B}.0)`);
    else if (f.transform === "linear") terms.push(`${w}*(COALESCE(${f.key},0)/100.0)`);
    else terms.push(`${w}*LN(1+MAX(0,COALESCE(${f.key},0)))`);
  }
  return terms.join(" + ") || "0";
}
export { ADDRESS_FACTORS };
