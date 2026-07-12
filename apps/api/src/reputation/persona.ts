/**
 * Address PERSONA — the single dominant role that answers "what IS this address?" (creator / collector /
 * merchant / trader / service). Orthogonal to reputation: reputation says whether to TRUST an address,
 * persona says what it DOES. A scammer can be a prolific Creator; an exchange is Service regardless of score.
 *
 * Pure, read-time, deterministic — same pattern as score.ts. It composes the SAME signals the archetype tags
 * already use (read/addresses.ts) into one primary identity, so the headline and the tag detail never disagree.
 * Every threshold/cap lives in config.ts (PERSONA) — this file is just the mechanism. Tune there, redeploy,
 * eyeball face-validity; no signal rebuild.
 *
 * Method: each role gets an INTENSITY = ln(1+x)/ln(1+cap) (∈[0,1], saturating at a "strong exemplar" cap) and
 * must clear a floor to qualify. Primary = the most intense qualifying role; ties break by identity-weight
 * (creator > merchant > trader > collector — creating is the most role-defining act). A close runner-up
 * (≥ secondaryRatio of the primary) surfaces as a secondary so mixed players read honestly ("Creator · also
 * collects"). A ranked user who clears no floor is a light Collector (holding is the default participation).
 */
import { PERSONA } from "./config";

export type Persona = "creator" | "collector" | "merchant" | "trader" | "service" | "dormant";

/** The infra/activity state resolved in read/addresses.ts: real users are "ranked", everything else is a
 *  structural identity or dormant. Persona defers to it — you can't be a Collector if you're an exchange. */
export type PersonaState = "ranked" | "exchange" | "deposit" | "vault" | "burn" | "service" | "dormant";

export interface PersonaResult {
  primary: Persona;
  secondary: Persona | null;
  label: string; // composed human headline, e.g. "Collector" or "Creator · also collects"
  blurb: string; // one-line meaning (tooltip)
}

/** Just the signal fields the classifier reads — a structural subset of AddressSignalsRow. */
export interface PersonaSignals {
  assets_issued: number;
  stamps_created: number;
  src20_deploys: number;
  dispenses: number;
  dex_trades: number;
  assets_held: number;
  assets_received: number;
}

const LABEL: Record<Persona, string> = {
  creator: "Creator", collector: "Collector", merchant: "Merchant", trader: "Trader", service: "Service", dormant: "Dormant",
};
const VERB: Record<Persona, string> = {
  creator: "creates", collector: "collects", merchant: "deals", trader: "trades", service: "", dormant: "",
};
const BLURB: Record<Persona, string> = {
  creator: "issues assets — an artist / creator",
  collector: "holds and accumulates assets",
  merchant: "runs dispensers — sells assets for BTC",
  trader: "actively trades on the DEX",
  service: "infrastructure — an exchange, deposit, vault, or hub, not a person",
  dormant: "appeared on-chain but has little reputation-bearing activity",
};

const num = (v: unknown) => Number(v) || 0;
const intensity = (x: number, cap: number) => (x <= 0 ? 0 : Math.min(1, Math.log1p(x) / Math.log1p(cap)));

export function classifyPersona(s: PersonaSignals, state: PersonaState): PersonaResult {
  if (state !== "ranked") {
    const primary: Persona = state === "dormant" ? "dormant" : "service";
    return { primary, secondary: null, label: LABEL[primary], blurb: BLURB[primary] };
  }
  const P = PERSONA;
  const create = num(s.assets_issued) + num(s.stamps_created) + 2 * num(s.src20_deploys); // deploys are heavier creation
  const held = num(s.assets_held) + 0.5 * num(s.assets_received);
  // Array order IS the identity-weight tiebreak — .sort is stable, so equal intensities keep this order.
  const roles: { k: Persona; i: number; ok: boolean }[] = [
    { k: "creator", i: intensity(create, P.creatorCap), ok: create >= P.creatorFloor },
    { k: "merchant", i: intensity(num(s.dispenses), P.merchantCap), ok: num(s.dispenses) >= P.merchantFloor },
    { k: "trader", i: intensity(num(s.dex_trades), P.traderCap), ok: num(s.dex_trades) >= P.traderFloor },
    { k: "collector", i: intensity(held, P.collectorCap), ok: num(s.assets_held) >= P.collectorFloor },
  ];
  const qualifying = roles.filter((r) => r.ok).sort((a, b) => b.i - a.i);
  if (qualifying.length === 0) {
    const primary: Persona = num(s.assets_held) > 0 ? "collector" : "dormant";
    return { primary, secondary: null, label: LABEL[primary], blurb: BLURB[primary] };
  }
  const primary = qualifying[0];
  const runner = qualifying[1];
  const secondary = runner && runner.i >= P.secondaryRatio * primary.i ? runner.k : null;
  const label = secondary ? `${LABEL[primary.k]} · also ${VERB[secondary]}` : LABEL[primary.k];
  return { primary: primary.k, secondary, label, blurb: BLURB[primary.k] };
}
