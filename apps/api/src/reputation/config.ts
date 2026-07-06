/**
 * Reputation & quality scoring — THE tuning surface. Every weight, transform, threshold, and anchor lives
 * here. The scorer (score.ts) is generic: it iterates these factor lists, so adding/retuning a signal is a
 * one-line edit here — no formula rewrite. Rationale + methodology: docs/reputation.md.
 *
 * Scores are computed at READ time from the precomputed signal tables, so weight changes apply on deploy
 * with no signal rebuild (only a brand-new signal COLUMN needs a signals.ts pass + rebuild).
 */

export type Transform = "log" | "age" | "span" | "linear";

export interface Factor {
  key: string;        // signals-row column (or a __special handled by the scorer)
  weight: number;     // tune me
  transform: Transform;
  label: string;      // short key in the score breakdown / evidence
  why: string;        // rationale (mirrored in docs/reputation.md)
}

export const SCALARS = {
  blockScale: 100000,        // block deltas divided by this in age/span terms
  modernActiveBlock: 900000, // active at/after this block earns the flat modern bonus
  modernActiveBonus: 1.5,
  // Staleness DECAY (2026-06-28): legacy time-terms are multiplied by halflife/(halflife+inactive_blocks),
  // floored — so an aged-but-inactive entity decays toward dormant instead of coasting. Gentle ("starts to
  // decay"): ~half credit after the half-life, never below the floor. Assets decay on time-since-last-trade
  // (recency_blocks); addresses on time-since-last-activity (tip-last_blk).
  assetDecayHalflife: 420480, assetDecayFloor: 0.6,  // ~8 years, gentle — assets are durable stores; a quiet
  //                                                     year shouldn't knock a real grail (RAREPEPE) off Bluechip
  addrDecayHalflife: 157680,  addrDecayFloor: 0.2,   // ~3 years — people go inactive; idle OGs should decay more
  // CIRCULATING-SCARCITY (2026-06-28): __circulating_scarcity = offset − log10(circulating supply), where
  // circulating = supply × (100 − burned_pct)/100. Rewards genuine scarcity, penalizes printed supply. Uses
  // CIRCULATING not issued — NINJASUIT issued 21M but burned ~100% → circ ~198 (correctly scarce); validated
  // on prod data. Offset 3.5 ⇒ ~neutral near 3,162 circulating, positive below, negative above.
  scarcityOffset: 3.5,
};

/* ---------- ADDRESS reputation ---------- */
// raw = Σ weight·transform(signal) (+ modern bonus). __age/__span use first_blk/last_blk.
export const ADDRESS_FACTORS: Factor[] = [
  { key: "__age",           weight: 2.0, transform: "age",    label: "age",       why: "longevity on-chain (under review: can dominate)" },
  { key: "__span",          weight: 1.0, transform: "span",   label: "span",      why: "active lifespan, not just early arrival" },
  { key: "survived_assets", weight: 2.0, transform: "log",    label: "creator",   why: "assets that found an audience (>=10 holders)" },
  { key: "dividends",       weight: 1.0, transform: "log",    label: "dividends", why: "pro-holder payouts" },
  { key: "locked_assets",   weight: 1.0, transform: "log",    label: "locked",    why: "locked supply (cannot rug)" },
  { key: "btc_fees",        weight: 1.2, transform: "log",    label: "btc_fees",  why: "miner fees paid — skin in the game" },
  { key: "btc_spent",       weight: 1.0, transform: "log",    label: "btc_spent", why: "BTC spent collecting" },
  { key: "dispense_btc",    weight: 0.8, transform: "log",    label: "merchant",  why: "BTC earned dispensing" },
  { key: "assets_held",     weight: 0.8, transform: "log",    label: "held",      why: "holdings breadth" },
  { key: "xcp",             weight: 1.0, transform: "log",    label: "xcp",       why: "XCP protocol stake" },
  { key: "dex_trades",      weight: 1.0, transform: "log",    label: "dex",       why: "DEX order-match participation" },
  { key: "stamps_created",  weight: 0.8, transform: "log",    label: "stamps",    why: "Bitcoin Stamp creation" },
  // INACTIVE: rep_score is never computed (always 1.0). Weight 0 until real graph-centrality exists.
  { key: "rep_score",       weight: 0.0, transform: "log",    label: "pagerank",  why: "graph centrality (not yet computed)" },
];

/* ---------- ASSET quality ---------- */
// __durability uses first_trade_blk/last_trade_blk. low_quality is a flat penalty (see PENALTY).
// REALIZED-VALUE-LED model (re-dialed 2026-06-28, "Variant C"). The grail-vs-scam-pepe problem: high-issuance
// pepes that were vaulted/ETH-pumped as a scam were ranking Bluechip off POPULARITY (durability + distinct
// traders + holders + current activity), which sustained pumping inflates. Validated against prod data
// (apps/api scratch /tmp lab): the clean discriminator is REALIZED ECONOMIC VALUE — grails were sold for real
// BTC/XCP (value_btc 1–4.6, value_xcp 4.4–5.7); the scam pepes have value_btc≈0 and modest value_xcp despite
// huge activity. So realized value now DOMINATES and the popularity family is trimmed hard. Bluechip ⇒ "people
// paid real money for this", which is also maximally gaming-resistant (you can't fake spending BTC). Result on
// the 12-asset grail/scam set: all 4 strong grails (SATOSHICARD/RAREPEPE/FDCARD/DARKPILLPEPE 48.5–55.7) clear
// every scam pepe (≤41.9) — margin +6.6. Supply-scarcity was tried first and ABANDONED: it was a leaky proxy
// (hit BITCORN/NINJASUIT, missed the 1000-supply TREEOFPEPE/RGBPEPE and the divisible TESTNETPEPE).
// NOTE: these weights were tuned on a 12-asset convergent-validity set — anchors below MUST be recalibrated
// against the full market population (/v2/reputation/asset-review) and face-checked before this is trusted.
export const ASSET_FACTORS: Factor[] = [
  // -- realized VALUE (worth, not volume) — THE grail signal: real money changed hands. Now dominant. --
  { key: "max_dispense_btc",    weight: 4.0, transform: "log",    label: "value_btc",   why: "largest BTC realized in a dispense — the strongest grail/scam discriminator: grails sold for real BTC, vault-pumped pepes have ~0. Can't be faked without spending BTC." },
  { key: "max_trade_xcp",       weight: 1.8, transform: "log",    label: "value_xcp",   why: "largest XCP realized in a DEX trade — realized value per sale (covers grails sold on the DEX, not via BTC dispenser)" },
  { key: "dispense_btc",        weight: 1.0, transform: "log",    label: "commerce",    why: "total real BTC commerce — sustained money in, not one lucky dispense" },
  { key: "distinct_dispensers", weight: 1.0, transform: "log",    label: "dispensers",  why: "distinct dispenser operators — breadth of who sold it for BTC (3.98x)" },
  // -- demand depth (hard to fake; core quality, but pumpable so trimmed from v1) --
  { key: "__trades_per_holder", weight: 1.5, transform: "log",    label: "demand_depth", why: "trades ÷ holders — demand depth airdrops can't fake (3.8x)" },
  { key: "__durability",        weight: 1.0, transform: "span",   label: "durability",  why: "traded over a long span (20.9x lift) — TRIMMED from 2.0: sustained pumping games a long active span, which is what floated the scam pepes" },
  { key: "distinct_traders",    weight: 0.9, transform: "log",    label: "traders",     why: "distinct market participants (10.3x) — TRIMMED from 1.5: scam pepes had many DEX speculators with no realized value" },
  // -- scarcity --
  { key: "burned_pct",          weight: 0.8, transform: "log",    label: "scarcity",    why: "% of supply burned — deflation, independent of popularity (6.68x)" },
  { key: "__circulating_scarcity", weight: 1.0, transform: "linear", label: "scarce_supply", why: "offset−log10(circulating supply) — rewards genuine scarcity, penalizes printed supply. CIRCULATING (burn-adjusted): NINJASUIT 21M issued/~100% burned→circ 198 stays scarce; demotes million-supply pumped pepes. Validated 2026-06-28." },
  // -- survivorship + recency (trimmed: 'still being pumped now' isn't quality) --
  { key: "__asset_age",         weight: 0.7, transform: "span",   label: "age",         why: "older = survived (1.48x); precomputed tip−first issuance. DECAYS if the asset has gone quiet." },
  { key: "recent_events",       weight: 0.3, transform: "log",    label: "current",     why: "trailing-12mo trades+dispenses — TRIMMED from 1.2: high 'current' was the scam pepes being actively pumped, not durable quality" },
  // -- popularity family (cheap to inflate → light) --
  { key: "holders",             weight: 0.4, transform: "log",    label: "holders",     why: "distribution breadth — TRIMMED: cheapest to inflate (dispense to sybils), and the pumps spread supply wide" },
  { key: "trades",              weight: 0.2, transform: "log",    label: "trades",      why: "raw volume (demoted — distinct_traders is the wash-resistant version)" },
  // -- community axis (kept on theory) --
  { key: "holder_breadth",      weight: 0.6, transform: "log",    label: "breadth",     why: "depth of its holders (community axis) — trimmed with the popularity family" },
  { key: "avg_holder_dex",      weight: 0.8, transform: "log",    label: "holder_qual", why: "held by active DEX traders — holder sophistication (2.23x)" },
  { key: "pct_creator_holders", weight: 0.5, transform: "linear", label: "creators",    why: "held by proven creators" },
];
export const ASSET_PENALTY = { lowQuality: -6.0 }; // wash/bridge/curated junk

/* ---------- output mapping ---------- */
// raw -> 0-100 percentile via piecewise-linear anchors. RECALIBRATE from /v2/reputation/review after any
// weight change (read the observed p50/p90/p99 of the population and set them here).
// Calibrated 2026-06-28 to the REAL-USER population (349,499 addresses; infra + passive throwaways excluded):
// p50=5.8, p90=12.7, p99=20, max=54.7. Ranking against real users (not deposits/vaults/burns/one-shot wallets)
// makes the score meaningful — those get honest non-ranked states (Exchange/Deposit/Vault/Burn/Service/Dormant).
export const ADDRESS_PCT = { floor: 0.5, p50: 2.5, p90: 4.7, p99: 17.5, max: 53 }; // recalibrated 06-28 w/ age-decay
// Calibrated 2026-06-28 to the raw distribution of assets WITH A MARKET (the 22,826 that ever traded or
// dispensed). The score ranks an asset against real, traded assets — not against ~132k held-but-never-traded
// or ~98k zero-holder assets, which would make every score meaningless. Those get honest non-ranked states
// (Untraded / Dormant). Market-asset percentiles: p50=15.1, p90=26.9, p99=41, max=60.6.
// Recalibrated 2026-06-28 (realized-value re-dial + circulating-scarcity) against the 22,824 market assets:
// observed p50=11.68, p90=22.01, p99=36.64, max=56.87.
export const ASSET_PCT   = { floor: 1, p50: 11.68, p90: 22.01, p99: 36.64, max: 56.87 };

// Asset quality TIERS — the primary display (the 0-100 score is a heuristic, so we lead with a coarse, honest
// tier and keep the number as detail). Tiers cut on RAW (= exact percentiles of the market population). Each
// states its meaning so an open-source reader knows precisely what it asserts. Two non-ranked states below:
//   Untraded = issued & held but never traded/dispensed · Dormant = no holders at all.
// Bluechip is deliberately set TIGHTER than p99 — at raw≥45 (top ~0.1%, ~19 assets) — so it means genuinely
// elite and excludes the borderline knockoffs that cluster just under it (the grail-vs-scam separability limit:
// objective signals can't tell a 1000-supply knockoff from a thin grail). Established/Active are the p90/p50.
export const ASSET_TIERS: { tier: string; minRaw: number; meaning: string }[] = [
  { tier: "Bluechip",    minRaw: 45,     meaning: "top ~0.1% of assets with a market — elite: real realized value + scarcity + durable demand" },
  { tier: "Established", minRaw: 22.01,  meaning: "top ~10% — sustained real trading and distribution" },
  { tier: "Active",      minRaw: 11.68,  meaning: "upper half of assets that have a real market" },
  { tier: "Speculative", minRaw: -1e9,   meaning: "has a market but thin / early" },
];

// Address reputation TIERS — primary display, parallel to the asset tiers. Cut on RAW (= exact percentiles of
// the REAL-USER population). Each states its meaning. Non-ranked states (infra + dormant) are handled in
// addressTier() and labelled via ADDRESS_TIER_MEANING below. Retires the old vague Established/Proven/Active.
export const ADDRESS_TIERS: { tier: string; minRaw: number; meaning: string }[] = [
  { tier: "OG",          minRaw: 17.5,  meaning: "top ~1% of real users — deep, long, STILL-active history" },
  { tier: "Established", minRaw: 4.7,   meaning: "top ~10% — a credible, sustained Counterparty history" },
  { tier: "Active",      minRaw: 2.5,   meaning: "upper half of real users — an ongoing presence" },
  { tier: "Casual",      minRaw: -1e9,  meaning: "a real user with a light footprint" },
];
// Plain-language meaning for every tier + non-ranked state, surfaced in the API so no label is unexplained.
export const ADDRESS_TIER_MEANING: Record<string, string> = {
  OG: ADDRESS_TIERS[0].meaning, Established: ADDRESS_TIERS[1].meaning,
  Active: ADDRESS_TIERS[2].meaning, Casual: ADDRESS_TIERS[3].meaning,
  Exchange: "exchange / service infrastructure — not a user score",
  "Exchange deposit": "an exchange deposit / forwarding address — not a user",
  Vault: "an Emblem Vault custody address — a container, not a person",
  Burn: "a burn address",
  Service: "a high-degree service / hub address — not an individual",
  Dormant: "appeared on-chain but no reputation-bearing activity",
  "No history": "no Counterparty activity",
};
export const OG = { minAgeBlocks: 43800, modernBlock: 850000 };
export const TAG = {
  creatorSurvived: 20, collectorHeld: 100, merchantDispenses: 5, whaleXcp: 50000, whaleHeld: 500,
  burnerAssets: 3, stampCreator: 5, stampCollector: 20,
};
