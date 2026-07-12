/**
 * Generic scorer driven by config.ts factor lists. Same config powers single-row scoring (the read
 * endpoint) AND the population SQL (the /v2/reputation/review calibration endpoint) — one source of truth,
 * so a weight edit can never drift between "what we show" and "what we calibrate against".
 */
import {
  type Factor,
  SCALARS,
  ADDRESS_FACTORS,
  ASSET_FACTORS,
  ASSET_PENALTY,
  ADDRESS_PCT,
  ASSET_PCT,
  ASSET_TIERS,
  ADDRESS_TIERS,
  CONVICTION_FACTORS,
  CONVICTION_PCT,
} from "./config";
import type { AssetSignalsRow, AddressSignalsRow } from "../schema";

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
const assetDecay = (row: FeatureRow) =>
  Math.max(
    SCALARS.assetDecayFloor,
    SCALARS.assetDecayHalflife / (SCALARS.assetDecayHalflife + num(row.recency_blocks)),
  );
const addrDecay = (row: FeatureRow, tip: number) =>
  Math.max(
    SCALARS.addrDecayFloor,
    SCALARS.addrDecayHalflife / (SCALARS.addrDecayHalflife + Math.max(0, tip - num(row.last_block))),
  );

/* ---------- single-row scoring (read endpoint) ---------- */

function factorValue(f: Factor, row: FeatureRow, tip: number): number {
  // derived ratios (not stored columns) — computed from the row
  if (f.key === "__trades_per_holder") return ln(num(row.trades) / (num(row.holders) || 1));
  if (f.key === "__asset_age") return (num(row.age_blocks) / SCALARS.blockScale) * assetDecay(row); // decays if the asset went quiet
  // durability is GATED by distinct traders: a long span counts only to the extent real people sustained the
  // trading (dt/(dt+3) → 0 at no traders, ~0.5 at 3, →1 with many). Kills the "two wash trades years apart" game.
  // Then DECAYED by staleness (recency_blocks) so a long-dead market doesn't keep full durability credit.
  if (f.key === "__durability") {
    const dt = num(row.distinct_traders);
    return (
      ((num(row.last_trade_blk) - num(row.first_trade_blk)) / SCALARS.blockScale) * (dt / (dt + 3)) * assetDecay(row)
    );
  }
  // realized USD, GATED by distinct buyers (B/(B+3), B = traders + dispense buyers) — mirrors __durability's
  // gate so a single huge sale to 1-2 buyers can't dominate the score (the thin-whale vector).
  if (f.key === "__realized_usd") {
    const b = num(row.distinct_traders) + num(row.distinct_dispense_buyers);
    return ln(num(row.max_realized_usd)) * (b / (b + 3));
  }
  // circulating-scarcity: offset − log10(circulating supply). circulating = supply × (100 − burned_pct)/100
  // (burn-adjusted, so a fully-burned high-issuance asset reads as scarce). Zero/unknown supply → no signal.
  if (f.key === "__circulating_scarcity") {
    const supply = num(row.supply);
    if (supply <= 0) return 0;
    const circ = Math.max(1, (supply * (100 - num(row.burned_pct))) / 100);
    return SCALARS.scarcityOffset - Math.log10(circ);
  }
  // graph trust is a tiny PPR mass (~1e-4); scale ×1e6 into a usable log range for the Conviction signal.
  if (f.key === "__graph_trust") return ln(num(row.graph_trust) * 1e6);
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

export function scoreAsset(row: Partial<AssetSignalsRow>): Scored {
  const s = sumFactors(ASSET_FACTORS, row as unknown as FeatureRow, 0);
  if (num(row.low_quality) === 1) {
    s.raw += ASSET_PENALTY.lowQuality;
    s.breakdown.low_quality = ASSET_PENALTY.lowQuality;
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
export const assetScore = (raw: number) => Math.round(percentile(raw, ASSET_PCT));

/** Conviction — the "who holds it + how scarce" score, ORTHOGONAL to market (no trade/realized inputs).
 *  Junk (low_quality) has zero conviction. Pairs with assetScore to surface undervalued grails (Conviction
 *  high, market low). Uses the same config-driven scorer, so it shares factorValue/rawSqlExpr parity. */
export function scoreConviction(row: Partial<AssetSignalsRow>): Scored {
  if (num((row as unknown as FeatureRow).low_quality) === 1) return { raw: 0, breakdown: {} };
  return sumFactors(CONVICTION_FACTORS, row as unknown as FeatureRow, 0);
}
export const convictionScore = (raw: number) => Math.round(percentile(raw, CONVICTION_PCT));
export { CONVICTION_FACTORS };

// Asset quality tier (the primary display). state: "market" = ever traded/dispensed (ranked into a tier);
// "held" = issued & held but no market (Untraded); "none" = no holders (Dormant). Tiers cut on raw.
// low_quality is a CLASSIFICATION, not a score component: it hard-caps the tier at Speculative regardless
// of raw (the additive penalty only orders raws; on the Phase-B scale it can't demote — OXBT proved a
// wash/bridge asset rode $9M of flow to Established despite the penalty). Parallel to infra address states.
export type MarketState = "market" | "held" | "none";
export function assetTier(raw: number, state: MarketState, lowQuality = false): string {
  if (state === "none") return "Dormant";
  if (state === "held") return "Untraded";
  if (lowQuality) return "Speculative";
  for (const t of ASSET_TIERS) if (raw >= t.minRaw) return t.tier;
  return "Speculative";
}

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
    const aDk = `MAX(${SCALARS.assetDecayFloor},${SCALARS.assetDecayHalflife}.0/(${SCALARS.assetDecayHalflife}.0+COALESCE(recency_blocks,0)))`; // asset staleness decay
    const adDk = `MAX(${SCALARS.addrDecayFloor},${SCALARS.addrDecayHalflife}.0/(${SCALARS.addrDecayHalflife}.0+MAX(0,${tip}-COALESCE(last_block,${tip}))))`; // address idle decay
    if (f.key === "__realized_usd")
      terms.push(
        `${w}*LN(1+MAX(0,COALESCE(max_realized_usd,0)))*((COALESCE(distinct_traders,0)+COALESCE(distinct_dispense_buyers,0))*1.0/(COALESCE(distinct_traders,0)+COALESCE(distinct_dispense_buyers,0)+3.0))`,
      );
    else if (f.key === "__trades_per_holder") terms.push(`${w}*LN(1+MAX(0,COALESCE(trades,0)*1.0/NULLIF(holders,0)))`);
    else if (f.key === "__asset_age") terms.push(`${w}*(COALESCE(age_blocks,0)/${B}.0)*${aDk}`);
    else if (f.key === "__durability")
      terms.push(
        `${w}*((COALESCE(last_trade_blk,0)-COALESCE(first_trade_blk,0))/${B}.0)*(COALESCE(distinct_traders,0)*1.0/(COALESCE(distinct_traders,0)+3.0))*${aDk}`,
      );
    else if (f.key === "__circulating_scarcity")
      terms.push(
        `${w}*(CASE WHEN COALESCE(supply,0)<=0 THEN 0 ELSE ${SCALARS.scarcityOffset} - LN(MAX(1.0,COALESCE(supply,0)*(100-COALESCE(burned_pct,0))/100.0))/LN(10) END)`,
      );
    else if (f.key === "__graph_trust") terms.push(`${w}*LN(1+MAX(0,COALESCE(graph_trust,0)*1000000.0))`);
    else if (f.transform === "age")
      terms.push(`${w}*MIN(${SCALARS.addrAgeCap},((${tip}-COALESCE(first_block,${tip}))/${B}.0)*${adDk})`); // age transform winsorized (mirrors score.ts Math.min)
    else if (f.transform === "span") terms.push(`${w}*((COALESCE(last_block,0)-COALESCE(first_block,0))/${B}.0)`);
    else if (f.transform === "linear") terms.push(`${w}*(COALESCE(${f.key},0)/100.0)`);
    else terms.push(`${w}*LN(1+MAX(0,COALESCE(${f.key},0)))`);
  }
  return terms.join(" + ") || "0";
}
export { ADDRESS_FACTORS, ASSET_FACTORS };
