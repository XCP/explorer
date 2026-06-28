/**
 * Generic scorer driven by config.ts factor lists. Same config powers single-row scoring (the read
 * endpoint) AND the population SQL (the /v2/reputation/review calibration endpoint) — one source of truth,
 * so a weight edit can never drift between "what we show" and "what we calibrate against".
 */
import {
  type Factor, SCALARS, ADDRESS_FACTORS, ASSET_FACTORS, ASSET_PENALTY, ADDRESS_PCT, ASSET_PCT, ASSET_TIERS, ADDRESS_TIERS,
} from "./config";

const num = (v: any) => Number(v) || 0;
const ln = (x: number) => Math.log(1 + Math.max(0, x));

/* ---------- single-row scoring (read endpoint) ---------- */

function factorValue(f: Factor, row: any, tip: number): number {
  // derived ratios (not stored columns) — computed from the row
  if (f.key === "__trades_per_holder") return ln(num(row.trades) / (num(row.holders) || 1));
  if (f.key === "__asset_age") return num(row.age_blocks) / SCALARS.blockScale; // precomputed tip−first_issuance, scaled like age/span
  // durability is GATED by distinct traders: a long span counts only to the extent real people sustained the
  // trading (dt/(dt+3) → 0 at no traders, ~0.5 at 3, →1 with many). Kills the "two wash trades years apart" game.
  if (f.key === "__durability") {
    const dt = num(row.distinct_traders);
    return ((num(row.last_trade_blk) - num(row.first_trade_blk)) / SCALARS.blockScale) * (dt / (dt + 3));
  }
  switch (f.transform) {
    case "age": return (tip - num(row.first_blk)) / SCALARS.blockScale;
    case "span": return (num(row.last_blk) - num(row.first_blk)) / SCALARS.blockScale; // __span (address)
    case "linear": return num(row[f.key]) / 100;
    default: return ln(num(row[f.key])); // "log"
  }
}

export interface Scored { raw: number; breakdown: Record<string, number>; }

function sumFactors(factors: Factor[], row: any, tip: number): Scored {
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

export function scoreAddress(row: any, tip: number): Scored {
  const s = sumFactors(ADDRESS_FACTORS, row, tip);
  if (num(row.last_blk) >= SCALARS.modernActiveBlock) { s.raw += SCALARS.modernActiveBonus; s.breakdown.modern = SCALARS.modernActiveBonus; }
  return s;
}

export function scoreAsset(row: any): Scored {
  const s = sumFactors(ASSET_FACTORS, row, 0);
  if (num(row.low_quality) === 1) { s.raw += ASSET_PENALTY.lowQuality; s.breakdown.low_quality = ASSET_PENALTY.lowQuality; }
  return s;
}

/* ---------- raw -> 0-100 percentile via piecewise-linear anchors ---------- */
type Anchors = { floor: number; p50: number; p90: number; p99: number; max: number };
export function percentile(raw: number, a: Anchors): number {
  if (raw <= a.floor) return 0;
  if (raw <= a.p50) return (raw - a.floor) / (a.p50 - a.floor) * 50;
  if (raw <= a.p90) return 50 + (raw - a.p50) / (a.p90 - a.p50) * 40;
  if (raw <= a.p99) return 90 + (raw - a.p90) / (a.p99 - a.p90) * 9;
  return Math.min(100, 99 + (raw - a.p99) / (a.max - a.p99));
}
export const addressScore = (raw: number) => Math.round(percentile(raw, ADDRESS_PCT));
export const assetScore = (raw: number) => Math.round(percentile(raw, ASSET_PCT));

// Asset quality tier (the primary display). state: "market" = ever traded/dispensed (ranked into a tier);
// "held" = issued & held but no market (Untraded); "none" = no holders (Dormant). Tiers cut on raw.
export type MarketState = "market" | "held" | "none";
export function assetTier(raw: number, state: MarketState): string {
  if (state === "none") return "Dormant";
  if (state === "held") return "Untraded";
  for (const t of ASSET_TIERS) if (raw >= t.minRaw) return t.tier;
  return "Speculative";
}

// Address reputation tier (primary display). Non-ranked states (infra + dormant) return their own label;
// real users are ranked into a tier by raw. Parallel to assetTier.
export type AddrState = "exchange" | "deposit" | "vault" | "burn" | "service" | "dormant" | "ranked";
const ADDR_STATE_LABEL: Record<Exclude<AddrState, "ranked">, string> = {
  exchange: "Exchange", deposit: "Exchange deposit", vault: "Vault", burn: "Burn", service: "Service", dormant: "Dormant",
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
    const w = f.weight, B = SCALARS.blockScale;
    if (f.key === "__trades_per_holder") terms.push(`${w}*LN(1+MAX(0,COALESCE(trades,0)*1.0/NULLIF(holders,0)))`);
    else if (f.key === "__asset_age") terms.push(`${w}*(COALESCE(age_blocks,0)/${B}.0)`);
    else if (f.key === "__durability") terms.push(`${w}*((COALESCE(last_trade_blk,0)-COALESCE(first_trade_blk,0))/${B}.0)*(COALESCE(distinct_traders,0)*1.0/(COALESCE(distinct_traders,0)+3.0))`);
    else if (f.transform === "age") terms.push(`${w}*((${tip}-COALESCE(first_blk,${tip}))/${B}.0)`);
    else if (f.transform === "span") terms.push(`${w}*((COALESCE(last_blk,0)-COALESCE(first_blk,0))/${B}.0)`);
    else if (f.transform === "linear") terms.push(`${w}*(COALESCE(${f.key},0)/100.0)`);
    else terms.push(`${w}*LN(1+MAX(0,COALESCE(${f.key},0)))`);
  }
  return terms.join(" + ") || "0";
}
export { ADDRESS_FACTORS, ASSET_FACTORS };
