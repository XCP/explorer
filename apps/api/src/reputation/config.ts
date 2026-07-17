/**
 * Address Reputation and Conviction tuning. Asset Rating is a separate materialized, validated rank model
 * owned by indexer/asset-rating.ts; it intentionally has no factor or tier configuration here.
 *
 * Scores are computed at READ time from the precomputed signal tables, so weight changes apply on deploy
 * with no signal rebuild (only a brand-new signal COLUMN needs a signals.ts pass + rebuild).
 */

export type Transform = "log" | "age" | "span" | "linear";

export interface Factor {
  key: string; // signals-row column (or a __special handled by the scorer)
  weight: number; // tune me
  transform: Transform;
  label: string; // short key in the score breakdown / evidence
  why: string; // rationale (mirrored in docs/reputation.md)
}

export const SCALARS = {
  blockScale: 100000, // block deltas divided by this in age/span terms
  modernActiveBlock: 900000, // active at/after this block earns the flat modern bonus
  modernActiveBonus: 1.5,
  // ADDRESS AGE CAP (2026-07-06): winsorize the (decayed) age TRANSFORM at 4.0 (≈ blocks for ~7.6yr). Rationale:
  // 'was early' ≠ 'is reputable' — uncapped age let the oldest addresses dominate reputation on longevity alone.
  // Per the H2 age-cap lab (2026-06-27): capping at 4.0 promotes 436 modern-active creators into the top tier
  // with negligible downside (only 16 pure-idle-OG freeloaders benefited). Applied pre-weight (weight 2.0 still
  // multiplies), in BOTH the TS transform (score.ts) and rawSqlExpr's SQL so read-time and population scoring can't drift.
  addrAgeCap: 4.0,
  // Address staleness decay: old but inactive identities lose standing instead of coasting on history.
  addrDecayHalflife: 157680,
  addrDecayFloor: 0.2, // ~3 years — people go inactive; idle OGs should decay more
  // CIRCULATING-SCARCITY (2026-06-28): __circulating_scarcity = offset − log10(circulating supply), where
  // circulating = supply × (100 − burned_pct)/100. Rewards genuine scarcity, penalizes printed supply. Uses
  // CIRCULATING not issued — NINJASUIT issued 21M but burned ~100% → circ ~198 (correctly scarce); validated
  // on prod data. Offset 3.5 ⇒ ~neutral near 3,162 circulating, positive below, negative above.
  scarcityOffset: 3.5,
};

/* ---------- ADDRESS reputation ---------- */
// raw = Σ weight·transform(signal) (+ modern bonus). __age/__span use first_block/last_block.
export const ADDRESS_FACTORS: Factor[] = [
  {
    key: "__age",
    weight: 2.0,
    transform: "age",
    label: "age",
    why: "longevity on-chain — transform CAPPED at SCALARS.addrAgeCap ('was early' ≠ 'is reputable'; H2 lab 2026-06-27)",
  },
  { key: "__span", weight: 1.0, transform: "span", label: "span", why: "active lifespan, not just early arrival" },
  {
    key: "survived_assets",
    weight: 2.0,
    transform: "log",
    label: "creator",
    why: "assets that found an audience (>=10 holders)",
  },
  { key: "dividends", weight: 1.0, transform: "log", label: "dividends", why: "pro-holder payouts" },
  { key: "locked_assets", weight: 1.0, transform: "log", label: "locked", why: "locked supply (cannot rug)" },
  { key: "btc_fees", weight: 1.2, transform: "log", label: "btc_fees", why: "miner fees paid — skin in the game" },
  { key: "btc_spent", weight: 1.0, transform: "log", label: "btc_spent", why: "BTC spent collecting" },
  { key: "dispense_btc", weight: 0.8, transform: "log", label: "merchant", why: "BTC earned dispensing" },
  { key: "assets_held", weight: 0.8, transform: "log", label: "held", why: "holdings breadth" },
  { key: "xcp", weight: 1.0, transform: "log", label: "xcp", why: "XCP protocol stake" },
  { key: "dex_trades", weight: 1.0, transform: "log", label: "dex", why: "DEX order-match participation" },
  { key: "stamps_created", weight: 0.8, transform: "log", label: "stamps", why: "Bitcoin Stamp creation" },
  // PENALTY (2026-07-07): Emblem vault SCAMS. This BTC address cracked a vault (sent the wrapped card back
  // out) and an Emblem sale then happened AFTER the crack — a buyer paid for an empty shell (signals.ts
  // addr_vault_scams; counts DISTINCT such vaults). Cracking to redeem your OWN card is fine (the signal
  // requires a POST-crack sale, so honest redeemers score 0). Negative weight = the only explicit bad-actor
  // demerit in the address model. Weight −2.0 provisional: ln(1+n)·−2 ⇒ 1 scam −1.4, 3 −2.8, 10 −4.8 (wipes a
  // p90 score). RECALIBRATE once the vault_scams distribution is read over the population (few hundred crackers,
  // so ADDRESS_PCT anchors are unaffected). CAVEAT: a knowingly-disclosed "spent vault" collectible sale looks
  // identical on-chain — kept moderate for that reason. Never-funded scams have NO BTC actor, so aren't here.
  {
    key: "vault_scams",
    weight: -2.0,
    transform: "log",
    label: "vault_scam",
    why: "penalty: cracked a vault then an Emblem sale followed = sold an empty shell (bad actor)",
  },
  // PENALTY (2026-07-08): Emblem empty-SHELL scams attributed to this BTC identity via the creator bridge
  // (signals/emblem-scam.ts): they minted vaults NAMING a real Counterparty card that hold nothing, and are
  // the consistent BTC funder of their own real vaults. COUNT-scaled (log), not share-gated: a dedicated
  // scammer (e.g. 23 shells) is docked hard; a prolific creator with 1 stray shell gets ln(2)·−1.5 ≈ −1.0, a
  // nudge their real-vault/creator positives outweigh — so nobody is excluded by fiat, magnitude discriminates.
  // Collision-filtered (is_scam_shell requires the claimed card be wrapped by a real vault) so Ordinals/name
  // collisions (BITCOIN/TWELVEFOLD/…) don't count. RECALIBRATE weight once the population effect is read.
  {
    key: "shell_scams",
    weight: -1.5,
    transform: "log",
    label: "shell_scam",
    why: "penalty: minted empty Emblem shells claiming a real card = scammed buyers (bridged to this BTC identity)",
  },
  // PENALTY (2026-07-08): Emblem high-supply single-unit DUMPS. This BTC address funded single-unit vaults of
  // VERY-high-supply cards (supply ≥1M — PEPECASH's unit is worth $0.008, GUARDSPEPE's $0.0004) that then
  // sold on Emblem for ~$40 as "collectibles" — a thousands-to-∞× markup on a fungible fraction. Predatory.
  // Count-scaled: the repeat factories (300 dumps) are crushed (ln(301)·−1.5 ≈ −8.6); a one-off memento sale
  // is ln(2)·−1.5 ≈ −1.0. Direct attribution (the funder deposited the unit to dump it). signals/emblem-scam.ts.
  {
    key: "dump_scams",
    weight: -1.5,
    transform: "log",
    label: "dump_scam",
    why: "penalty: dumped single fungible units of very-high-supply cards as $40 Emblem NFTs (thousands-x markup)",
  },
];

/* ---------- CONVICTION — holder participation and scarcity, separate from market-price evidence ---------- */
export const CONVICTION_FACTORS: Factor[] = [
  {
    key: "avg_holder_dex",
    weight: 2.0,
    transform: "log",
    label: "sophistication",
    why: "held by active DEX traders — a sophisticated holder base, not passive airdrop wallets",
  },
  {
    key: "pct_creator_holders",
    weight: 1.5,
    transform: "linear",
    label: "creator_held",
    why: "held by proven creators — peer validation from people who make things",
  },
  {
    key: "__circulating_scarcity",
    weight: 1.5,
    transform: "linear",
    label: "scarcity",
    why: "genuinely scarce circulating supply (burn-adjusted) — a small real float",
  },
  {
    key: "holder_breadth",
    weight: 1.0,
    transform: "log",
    label: "holder_depth",
    why: "held by DEEP collectors (avg holdings-breadth of its holders) — serious collections, not one-offs",
  },
  {
    key: "holders",
    weight: 0.5,
    transform: "log",
    label: "distribution",
    why: "distributed to real holders (breadth), not a single wallet",
  },
  {
    key: "top1_pct",
    weight: -0.6,
    transform: "linear",
    label: "concentration",
    why: "PENALTY: dominated by one whale = not broad conviction, one holder can dump it",
  },
];
// Graph-free raw→0-100 anchors, calibrated 2026-07-16 over 155,462 clean assets with holders: p50 5.00,
// p90 16.86, p99 22.56, max 28.10. Seeded graph standing was removed after named review showed circular
// curation amplification and no demonstrated incremental predictive value.
export const CONVICTION_PCT = { floor: 2.0, p50: 5.0, p90: 16.86, p99: 22.56, max: 28.1 };

/* ---------- output mapping ---------- */
// raw -> 0-100 percentile via piecewise-linear anchors. RECALIBRATE from /v2/reputation/review after any
// weight change (read the observed p50/p90/p99 of the population and set them here).
// Recalibrated 2026-07-06 for the ADDRESS AGE CAP (SCALARS.addrAgeCap): read the observed percentiles of the
// CAPPED raw over the SAME real-user population /v2/reputation/review ranks (infra + passive throwaways excluded).
// Live query at tip 956,949 over n=261,746 real users: p50=2.88, p90=5.22, p99=16.33, max=51.15, min=0.005.
// The cap compresses the top (old p99 17.5→16.33, max 53→51.15); the mid barely moves. Ranking against real
// users (not deposits/vaults/burns/one-shot wallets) makes the score meaningful — those get honest non-ranked
// states (Exchange/Deposit/Vault/Burn/Service/Dormant).
export const ADDRESS_PCT = { floor: 0.5, p50: 2.88, p90: 5.22, p99: 16.33, max: 51.15 }; // recalibrated 07-06 w/ age-cap
// Address reputation TIERS — primary display, parallel to the asset tiers. Cut on RAW (= exact percentiles of
// the REAL-USER population). Each states its meaning. Non-ranked states (infra + dormant) are handled in
// addressTier() and labelled via ADDRESS_TIER_MEANING below. Retires the old vague Established/Proven/Active.
// Cutoffs recalibrated 2026-07-09 against the corrected 400,913-user pool (after "no history" collapsed
// to ~0 — every known address is now scored). The pool grew at the low end, so the top-1/10/50% lines
// dropped: histogram percentiles over the live distribution put them at ~15 / ~5 / ~2.5.
export const ADDRESS_TIERS: { tier: string; minRaw: number; meaning: string }[] = [
  { tier: "OG", minRaw: 15.0, meaning: "top ~1% of real users — deep, long, STILL-active history" },
  { tier: "Established", minRaw: 5.0, meaning: "top ~10% — a credible, sustained Counterparty history" },
  { tier: "Active", minRaw: 2.5, meaning: "upper half of real users — an ongoing presence" },
  { tier: "Casual", minRaw: -1e9, meaning: "a real user with a light footprint" },
];
// Plain-language meaning for every tier + non-ranked state, surfaced in the API so no label is unexplained.
export const ADDRESS_TIER_MEANING: Record<string, string> = {
  OG: ADDRESS_TIERS[0].meaning,
  Established: ADDRESS_TIERS[1].meaning,
  Active: ADDRESS_TIERS[2].meaning,
  Casual: ADDRESS_TIERS[3].meaning,
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
  creatorSurvived: 20,
  collectorHeld: 100,
  merchantDispenses: 5,
  whaleXcp: 50000,
  whaleHeld: 500,
  burnerAssets: 3,
  stampCreator: 5,
  stampCollector: 20,
};

/* ---------- ADDRESS PERSONA (2026-07-10) — the tuning surface for reputation/persona.ts ----------
// The single dominant role (creator/collector/merchant/trader) picked from behavior. A role QUALIFIES if it
// clears its floor; among qualifiers the most INTENSE wins, where intensity = ln(1+x)/ln(1+cap) saturates at
// the cap (a "strong exemplar" of that role). Caps are the real knobs: lower a cap to let fewer actions max
// out a role (surfacing light-but-real creators), raise it to demand more. Ties break creator>merchant>
// trader>collector (creating is the most role-defining act). Floors are aligned with the archetype tags so the
// headline persona never contradicts the tag chips. V1 starting values — face-check on prod and retune. */
export const PERSONA = {
  creatorFloor: 1, // issued/created ≥1 thing at all (creation is rare → a low bar still means "a creator")
  merchantFloor: 5, // = TAG.merchantDispenses — runs at least a few dispenses
  traderFloor: 10, // ≥10 DEX trades — an actual trader, not one incidental swap
  collectorFloor: 10, // ≥10 distinct assets held — a real collection, not a stray airdrop
  creatorCap: 20,
  merchantCap: 50,
  traderCap: 100,
  collectorCap: 150, // intensity saturates here
  secondaryRatio: 0.6, // a runner-up role must be ≥60% as intense as the primary to show as a secondary
};
