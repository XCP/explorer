/**
 * Scorer correctness tests for src/reputation/{score.ts,config.ts}. These are PURE-function tests: no DB,
 * no network — they pin the scoring engine against an INDEPENDENT re-derivation of the same math.
 *
 * The engine (score.ts) is generic: it iterates the config.ts factor lists. So the risk it can't catch by
 * construction is a WIRING bug — a factor reading the wrong column, applying the wrong transform, a decay
 * dropped, the modern bonus misfiring, a tier cut off-by-one, or the population SQL emitting a bind
 * placeholder. Every expectation below is computed FROM the live config (weights/anchors/tiers are read out
 * of config.ts, never hardcoded) so a deliberate retune updates test and code together, while a wiring
 * regression still fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreAddress,
  scoreAsset,
  addressScore,
  assetScore,
  addressTier,
  assetTier,
  percentile,
  rawSqlExpr,
} from "../src/reputation/score";
import {
  SCALARS,
  ADDRESS_FACTORS,
  ASSET_FACTORS,
  ASSET_PENALTY,
  ADDRESS_PCT,
  ASSET_PCT,
  ASSET_TIERS,
  ADDRESS_TIERS,
} from "../src/reputation/config";

// mirror the engine's own numeric primitives (score.ts) so the re-derivation uses the identical definitions.
const num = (v: any) => Number(v) || 0;
const ln = (x: number) => Math.log(1 + Math.max(0, x));
const near = (a: number, b: number, msg = "", eps = 1e-9) =>
  assert(Math.abs(a - b) <= eps, `${msg}: ${a} not ~= ${b} (|Δ|=${Math.abs(a - b)})`);
// weight lookup BY LABEL — the test asserts "column X is scored under label L with transform T at config's
// weight", so pulling the weight from config keeps a retune from breaking the test while a mis-wire still does.
const aw = (label: string) => ADDRESS_FACTORS.find((f) => f.label === label)!.weight;
const sw = (label: string) => ASSET_FACTORS.find((f) => f.label === label)!.weight;

/* ---------- independent re-derivations of the raw score ---------- */

const addrDecay = (row: any, tip: number) =>
  Math.max(
    SCALARS.addrDecayFloor,
    SCALARS.addrDecayHalflife / (SCALARS.addrDecayHalflife + Math.max(0, tip - num(row.last_block))),
  );
const assetDecay = (row: any) =>
  Math.max(
    SCALARS.assetDecayFloor,
    SCALARS.assetDecayHalflife / (SCALARS.assetDecayHalflife + num(row.recency_blocks)),
  );

function expectedAddrRaw(row: any, tip: number): number {
  const B = SCALARS.blockScale;
  let r = 0;
  // age transform is decayed then WINSORIZED at SCALARS.addrAgeCap (cap pulled from config, not hardcoded).
  r += aw("age") * Math.min(SCALARS.addrAgeCap, ((tip - num(row.first_block)) / B) * addrDecay(row, tip));
  r += aw("span") * ((num(row.last_block) - num(row.first_block)) / B);
  r += aw("creator") * ln(num(row.survived_assets));
  r += aw("dividends") * ln(num(row.dividends));
  r += aw("locked") * ln(num(row.locked_assets));
  r += aw("btc_fees") * ln(num(row.btc_fees));
  r += aw("btc_spent") * ln(num(row.btc_spent));
  r += aw("merchant") * ln(num(row.dispense_btc));
  r += aw("held") * ln(num(row.assets_held));
  r += aw("xcp") * ln(num(row.xcp));
  r += aw("dex") * ln(num(row.dex_trades));
  r += aw("stamps") * ln(num(row.stamps_created));
  if (num(row.last_block) >= SCALARS.modernActiveBlock) r += SCALARS.modernActiveBonus;
  return r;
}

function expectedAssetRaw(row: any): number {
  const B = SCALARS.blockScale,
    dA = assetDecay(row);
  const supply = num(row.supply);
  const circ = supply <= 0 ? 0 : Math.max(1, (supply * (100 - num(row.burned_pct))) / 100);
  const dt = num(row.distinct_traders);
  let r = 0;
  // Phase B: primary realized-value factor, GATED by distinct buyers B/(B+3) (B = traders + dispense buyers)
  const gateB = dt + num(row.distinct_dispense_buyers);
  r += sw("value_usd") * ln(num(row.max_realized_usd)) * (gateB / (gateB + 3));
  r += sw("value_btc") * ln(num(row.max_dispense_btc_clean)); // Phase B: value_btc now reads the self-dispense-guarded column
  r += sw("value_xcp") * ln(num(row.max_trade_xcp));
  r += sw("commerce") * ln(num(row.dispense_btc));
  r += sw("dispensers") * ln(num(row.distinct_dispensers));
  r += sw("buyers") * ln(num(row.distinct_dispense_buyers)); // Phase B
  r += sw("emblem") * ln(num(row.emblem_trades)); // Phase B
  r += sw("demand_depth") * ln(num(row.trades) / (num(row.holders) || 1));
  r += sw("durability") * ((num(row.last_trade_blk) - num(row.first_trade_blk)) / B) * (dt / (dt + 3)) * dA;
  r += sw("traders") * ln(dt);
  r += sw("scarcity") * ln(num(row.burned_pct));
  r += sw("scarce_supply") * (supply <= 0 ? 0 : SCALARS.scarcityOffset - Math.log10(circ));
  r += sw("age") * ((num(row.age_blocks) / B) * dA);
  r += sw("current") * ln(num(row.recent_events));
  r += sw("holders") * ln(num(row.holders));
  r += sw("trades") * ln(num(row.trades));
  r += sw("breadth") * ln(num(row.holder_breadth));
  r += sw("holder_qual") * ln(num(row.avg_holder_dex));
  r += sw("creators") * (num(row.pct_creator_holders) / 100);
  if (num(row.low_quality) === 1) r += ASSET_PENALTY.lowQuality;
  return r;
}

/* ---------- empty / all-null coalescing ---------- */

test("scoreAsset: empty row coalesces every factor to 0 (no NaN, no undefined leakage)", () => {
  const s = scoreAsset({});
  near(s.raw, 0, "empty asset raw");
  for (const [label, v] of Object.entries(s.breakdown)) {
    assert.equal(typeof v, "number", `${label} breakdown must be a number`);
    assert(Number.isFinite(v), `${label} breakdown must be finite, got ${v}`);
    assert.equal(v, 0, `${label} contributes 0 on an empty row`);
  }
});

test("scoreAddress: empty row at tip 0 scores exactly 0 (age/decay terms vanish)", () => {
  const s = scoreAddress({}, 0);
  near(s.raw, 0, "empty address raw");
  assert(!("modern" in s.breakdown), "no modern bonus on an empty row");
});

test("breakdown keys are exactly the weighted factor labels", () => {
  const s = scoreAsset({ trades: 5, holders: 2 });
  const weighted = new Set(ASSET_FACTORS.filter((f) => f.weight).map((f) => f.label));
  for (const k of Object.keys(s.breakdown)) assert(weighted.has(k), `unexpected breakdown key ${k}`);
  // zero-weight factors (e.g. pagerank on the address side) must never appear
  assert(
    !("pagerank" in scoreAddress({ survived_assets: 3 }, 850000).breakdown),
    "zero-weight factor leaked into breakdown",
  );
});

/* ---------- a known good row scores where the re-derivation says ---------- */

test("scoreAddress: a substantive row matches the independent re-derivation (no modern bonus branch)", () => {
  const row = {
    first_block: 300000,
    last_block: 850000, // < modernActiveBlock, so NO bonus
    survived_assets: 5,
    dividends: 2,
    locked_assets: 3,
    btc_fees: 1.5,
    btc_spent: 4,
    dispense_btc: 0.5,
    assets_held: 40,
    xcp: 1000,
    dex_trades: 12,
    stamps_created: 0,
  };
  const tip = 870000;
  const s = scoreAddress(row, tip);
  near(s.raw, expectedAddrRaw(row, tip), "address raw");
  assert(!("modern" in s.breakdown), "row below modernActiveBlock must not get the modern bonus");
  assert(s.raw > 0, "a real OG-ish row scores positive");
});

test("scoreAddress: modern-active bonus is applied once, exactly SCALARS.modernActiveBonus", () => {
  const base = { first_block: 300000, survived_assets: 5, assets_held: 40, xcp: 1000, dex_trades: 12 };
  const tip = 960000;
  const quiet = scoreAddress({ ...base, last_block: SCALARS.modernActiveBlock - 1 }, tip);
  const modern = scoreAddress({ ...base, last_block: SCALARS.modernActiveBlock }, tip);
  assert.equal(modern.breakdown.modern, SCALARS.modernActiveBonus, "modern breakdown line = bonus");
  near(modern.raw, expectedAddrRaw({ ...base, last_block: SCALARS.modernActiveBlock }, tip), "modern raw");
  assert(!("modern" in quiet.breakdown), "one block below the cutoff earns no bonus");
});

test("scoreAsset: a market row matches the independent re-derivation (special transforms exercised)", () => {
  const row = {
    max_realized_usd: 5000,
    max_dispense_btc_clean: 1.5,
    distinct_dispense_buyers: 8,
    emblem_trades: 3, // Phase B realized-value factors
    max_trade_xcp: 5,
    dispense_btc: 3,
    distinct_dispensers: 4,
    trades: 100,
    holders: 20, // demand_depth = ln(trades/holders)
    last_trade_blk: 800000,
    first_trade_blk: 700000,
    distinct_traders: 10,
    recency_blocks: 50000, // durability + decay
    burned_pct: 10,
    supply: 1000, // circulating scarcity
    age_blocks: 200000,
    recent_events: 30,
    holder_breadth: 8,
    avg_holder_dex: 6,
    pct_creator_holders: 25,
    low_quality: 0,
  };
  const s = scoreAsset(row as Parameters<typeof scoreAsset>[0]);
  near(s.raw, expectedAssetRaw(row), "asset raw");
  assert(!("low_quality" in s.breakdown), "clean row must not carry the low_quality line");
});

test("scoreAsset: __circulating_scarcity returns 0 when supply is unknown/zero (guards div/log of 0)", () => {
  // supply<=0 must short-circuit the scarce_supply term to 0 (no log10 of 0). Isolate it: an otherwise-empty
  // row means the ONLY thing that could move raw is this factor, so raw==0 proves the guard fired.
  const zero = scoreAsset({ supply: 0 });
  near(zero.raw, 0, "zero-supply asset raw");
  assert.equal(zero.breakdown.scarce_supply, 0, "scarce_supply line is 0 without a supply");
  // and it stays guarded even when a burned_pct is present (the separate 'scarcity' factor still scores that)
  const withBurn = scoreAsset({ supply: 0, burned_pct: 50 });
  assert.equal(withBurn.breakdown.scarce_supply, 0, "scarce_supply stays 0 regardless of burned_pct");
});

/* ---------- low_quality penalty ---------- */

test("scoreAsset: low_quality applies the flat penalty on top of the earned raw", () => {
  const row = { max_realized_usd: 5000, trades: 100, holders: 20, distinct_traders: 10, supply: 1000, burned_pct: 10 };
  const clean = scoreAsset({ ...row, low_quality: 0 });
  const dirty = scoreAsset({ ...row, low_quality: 1 });
  near(dirty.raw - clean.raw, ASSET_PENALTY.lowQuality, "penalty delta");
  assert.equal(dirty.breakdown.low_quality, ASSET_PENALTY.lowQuality, "penalty line present");
  assert(ASSET_PENALTY.lowQuality < 0, "penalty must be a demotion");
});

/* ---------- tier boundaries (exact minRaw edges) ---------- */

test("assetTier: cuts exactly on each config minRaw (edge is inclusive, one ulp below drops a tier)", () => {
  // ASSET_TIERS is ordered high→low; verify the inclusive edge and the boundary just under it.
  for (let i = 0; i < ASSET_TIERS.length; i++) {
    const t = ASSET_TIERS[i];
    if (t.minRaw <= -1e8) continue; // the catch-all floor has no meaningful "just below"
    assert.equal(assetTier(t.minRaw, "market"), t.tier, `raw==${t.minRaw} is ${t.tier}`);
    const below = assetTier(t.minRaw - 1e-9, "market");
    assert.notEqual(below, t.tier, `raw just below ${t.minRaw} must drop out of ${t.tier}`);
  }
});

test("addressTier: cuts exactly on each config minRaw", () => {
  for (let i = 0; i < ADDRESS_TIERS.length; i++) {
    const t = ADDRESS_TIERS[i];
    if (t.minRaw <= -1e8) continue;
    assert.equal(addressTier(t.minRaw, "ranked"), t.tier, `raw==${t.minRaw} is ${t.tier}`);
    assert.notEqual(
      addressTier(t.minRaw - 1e-9, "ranked"),
      t.tier,
      `raw just below ${t.minRaw} drops out of ${t.tier}`,
    );
  }
});

test("assetTier: non-market states short-circuit regardless of raw", () => {
  assert.equal(assetTier(999, "held"), "Untraded", "held → Untraded even with a huge raw");
  assert.equal(assetTier(999, "none"), "Dormant", "none → Dormant even with a huge raw");
  assert.equal(assetTier(-999, "market"), "Speculative", "market floor → Speculative");
});

/* ---------- infra address states short-circuit (the is_exchange/is_burn invariant) ---------- */

test("addressTier: infra/dormant states ignore raw and return their own label", () => {
  const HUGE = 1e6; // a raw that would otherwise be OG — must NOT rank an exchange/burn/etc.
  assert.equal(addressTier(HUGE, "exchange"), "Exchange");
  assert.equal(addressTier(HUGE, "deposit"), "Exchange deposit");
  assert.equal(addressTier(HUGE, "vault"), "Vault");
  assert.equal(addressTier(HUGE, "burn"), "Burn");
  assert.equal(addressTier(HUGE, "service"), "Service");
  assert.equal(addressTier(HUGE, "dormant"), "Dormant");
  // only the "ranked" state consults the raw and the tier table
  assert.equal(addressTier(HUGE, "ranked"), ADDRESS_TIERS[0].tier, "ranked + huge raw → top tier");
});

/* ---------- percentile mapping lands on its anchors ---------- */

test("percentile: piecewise-linear map hits each anchor (0 / 50 / 90 / 99)", () => {
  near(percentile(ADDRESS_PCT.floor, ADDRESS_PCT), 0, "address floor→0");
  near(percentile(ADDRESS_PCT.p50, ADDRESS_PCT), 50, "address p50→50");
  near(percentile(ADDRESS_PCT.p90, ADDRESS_PCT), 90, "address p90→90");
  near(percentile(ADDRESS_PCT.p99, ADDRESS_PCT), 99, "address p99→99");
  near(percentile(ASSET_PCT.p50, ASSET_PCT), 50, "asset p50→50");
  near(percentile(ASSET_PCT.p90, ASSET_PCT), 90, "asset p90→90");
  assert.equal(assetScore(ASSET_PCT.p90), 90, "assetScore rounds p90 anchor to 90");
  assert.equal(addressScore(ADDRESS_PCT.floor), 0, "addressScore clamps the floor to 0");
});

test("percentile: below floor is 0, above max is clamped to 100", () => {
  assert.equal(percentile(ASSET_PCT.floor - 5, ASSET_PCT), 0, "below floor → 0");
  assert.equal(percentile(ASSET_PCT.max + 1e6, ASSET_PCT), 100, "far above max → clamped 100");
});

/* ---------- rawSqlExpr: bind-safety + parity invariants ---------- */

test("rawSqlExpr: emits NO bind placeholders (the adversarial-review invariant)", () => {
  const tip = 912345;
  for (const [name, factors] of [
    ["address", ADDRESS_FACTORS],
    ["asset", ASSET_FACTORS],
  ] as const) {
    const expr = rawSqlExpr(factors, tip);
    assert(!expr.includes("?"), `${name} population SQL must contain no '?' placeholders`);
    assert(expr.length > 0 && expr !== "0", `${name} expr should be a real expression`);
  }
});

test("rawSqlExpr: the tip literal is substituted (not parameterised) into the age terms", () => {
  const tip = 912345;
  const expr = rawSqlExpr(ADDRESS_FACTORS, tip);
  assert(expr.includes(String(tip)), "tip must appear as a literal in the address age/decay terms");
});

test("rawSqlExpr: address expression omits the xcp factor (per the score.ts contract)", () => {
  // score.ts skips key==="xcp" in the population SQL — it only shifts the absolute raw, absorbed by anchors.
  const expr = rawSqlExpr(ADDRESS_FACTORS, 900000);
  assert(!/\bxcp\b/i.test(expr), "xcp must not appear as a column in the population SQL");
});

test('rawSqlExpr: an all-zero-weight factor list collapses to the literal "0"', () => {
  const expr = rawSqlExpr([{ key: "held", weight: 0, transform: "log", label: "held", why: "" }], 900000);
  assert.equal(expr, "0", 'no weighted terms → "0" (safe, non-empty SQL)');
});

/* ---------- low_quality hard tier gate (Phase B round 3) ---------- */

test("assetTier: low_quality caps at Speculative regardless of raw (OXBT case)", () => {
  assert.equal(assetTier(1000, "market", true), "Speculative");
  assert.equal(assetTier(1000, "market", false) !== "Speculative", true);
  assert.equal(assetTier(1000, "held", true), "Untraded"); // non-market states unaffected
  assert.equal(assetTier(1000, "none", true), "Dormant");
});

test("scoreAsset __realized_usd gate: thin-buyer sale is damped, broad demand passes", () => {
  const base = { max_realized_usd: 900000, distinct_traders: 0 };
  const thin = scoreAsset({ ...base, distinct_dispense_buyers: 2 });
  const broad = scoreAsset({ ...base, distinct_dispense_buyers: 500 });
  // gate = B/(B+3): 2 buyers → 0.4, 500 buyers → ~0.994 (coarse tolerance: breakdown values are 2dp-rounded)
  const ratio = thin.breakdown.value_usd / broad.breakdown.value_usd;
  assert(Math.abs(ratio - 2 / 5 / (500 / 503)) < 0.01, `gate ratio ${ratio}`);
  assert(thin.raw < broad.raw, "thin whale must score below broad demand at equal USD");
});
