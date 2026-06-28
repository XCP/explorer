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
// Initial v1 weights from the 2026-06-27 sweep: allocate by measured strength (lift) ÷ redundancy (corr).
// DEMAND-DEPTH (strong, independent, hard-to-game) carries the most weight; the POPULARITY family
// (gameable/correlated: holders, trades, dispensers) is light; COMMUNITY is a separate axis we keep on theory.
// These are the STARTING point for the dialing loop — validated against vaulted + social mentions + grails.
export const ASSET_FACTORS: Factor[] = [
  // -- demand depth (hard to fake; the core quality axis) --
  { key: "__durability",        weight: 2.0, transform: "span",   label: "durability",  why: "traded over a long span (20.9x lift, independent — strongest signal)" },
  { key: "__trades_per_holder", weight: 1.5, transform: "log",    label: "demand_depth", why: "trades ÷ holders — demand depth airdrops can't fake (3.8x)" },
  { key: "distinct_traders",    weight: 1.5, transform: "log",    label: "traders",     why: "distinct market participants — wash-resistant breadth (10.3x lift)" },
  // -- scarcity --
  { key: "burned_pct",          weight: 0.8, transform: "log",    label: "scarcity",    why: "% of supply burned — deflation, independent of popularity (6.68x)" },
  // -- realized VALUE (worth, not volume) — the grail signal: high price at low volume (2026-06-28 lab) --
  { key: "max_dispense_btc",    weight: 1.5, transform: "log",    label: "value_btc",   why: "largest BTC realized in a dispense — worth; surfaces scarce grails that volume misses" },
  { key: "max_trade_xcp",       weight: 0.6, transform: "log",    label: "value_xcp",   why: "largest XCP realized in a DEX trade — realized value per sale" },
  // -- survivorship + recency --
  { key: "__asset_age",         weight: 1.0, transform: "span",   label: "age",         why: "older = survived (1.48x); precomputed tip−first issuance. DECAYS if the asset has gone quiet." },
  { key: "recent_events",       weight: 1.2, transform: "log",    label: "current",     why: "trailing-12mo trades+dispenses — current relevance / still-alive (6.59x lift)" },
  // -- popularity family (correlated, weaker than demand depth → light) --
  // (down-weighted by MEASURED STRENGTH: holders 2.95x vs durability 20.9x — not by an "airdrop" claim,
  //  which was tested & refuted: high-holder/low-trade assets here got holders via paid dispensers, not airdrops.)
  { key: "holders",             weight: 1.0, transform: "log",    label: "holders",     why: "distribution breadth (weaker than demand signals; correlated with trades)" },
  { key: "trades",              weight: 0.5, transform: "log",    label: "trades",      why: "raw volume (demoted — distinct_traders is the wash-resistant version)" },
  { key: "distinct_dispensers", weight: 0.6, transform: "log",    label: "dispensers",  why: "distinct dispenser operators (3.98x)" },
  { key: "dispense_btc",        weight: 0.5, transform: "log",    label: "commerce",    why: "real BTC commerce (venue axis)" },
  // -- community axis (inverse to the collectible proxy, kept on theory) --
  { key: "holder_breadth",      weight: 1.0, transform: "log",    label: "breadth",     why: "depth of its holders (community axis)" },
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
export const ASSET_PCT   = { floor: 1, p50: 14.5, p90: 26.1, p99: 44.5, max: 72 }; // recalibrated 06-28 w/ realized value

// Asset quality TIERS — the primary display (the 0-100 score is a heuristic, so we lead with a coarse, honest
// tier and keep the number as detail). Tiers cut on RAW (= exact percentiles of the market population). Each
// states its meaning so an open-source reader knows precisely what it asserts. Two non-ranked states below:
//   Untraded = issued & held but never traded/dispensed · Dormant = no holders at all.
export const ASSET_TIERS: { tier: string; minRaw: number; meaning: string }[] = [
  { tier: "Bluechip",    minRaw: 44.5,  meaning: "top ~1% of assets with a market — deep, durable, valuable" },
  { tier: "Established", minRaw: 26.1,  meaning: "top ~10% — sustained real trading and distribution" },
  { tier: "Active",      minRaw: 14.5,  meaning: "upper half of assets that have a real market" },
  { tier: "Speculative", minRaw: -1e9,  meaning: "has a market but thin / early" },
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
