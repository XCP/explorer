# Reputation & Quality Scoring

How xcp.io rates **addresses** (who is a credible actor) and **assets** (which tokens are real vs noise).
This is the single rationale doc; all the knobs live in `src/reputation/config.ts` and the math in
`src/reputation/score.ts`. Adjust weights there → deploy → review (`/v2/reputation/review`) → repeat.

---

## Design principles

1. **Earned, intrinsic, mud-proof.** Score from on-chain behavior the address *did*, not from balances
   that can be borrowed/dusted. Counts use a **log transform** (`ln(1+x)`) so the 100th asset matters far
   less than the 1st — diminishing returns resist farming.
2. **Separate infrastructure from users.** Exchanges, exchange-deposit plumbing, burns, and Emblem-vault
   custody addresses are *classified out* (their own bands), never scored as if they were collectors/creators.
3. **Sybil/wash resistance.** Wash-traded and bridge/exchange "low-quality" assets are excluded from the
   economic signals (`clean_*` variants); self-trade % flags fake volume; dust-to-burn can't farm "Burner".
4. **Explainable, not a black box.** Every score ships an `evidence` breakdown and archetype `tags`. A number
   nobody can explain is worse than no number.
5. **Percentile-mapped output.** The raw weighted sum is heavily skewed; we map it through piecewise-linear
   anchors to a 0–100 score so bands are stable and human-readable.

---

## Address reputation — factors (current weights)

`raw = Σ weightᵢ · transformᵢ(signalᵢ)` then `score = percentile(raw)`, clamped 0–100.

| factor | weight | transform | why |
|---|---|---|---|
| `age` | 2.0 | (tip−first)/1e5 | Longevity: surviving on-chain for years is hard to fake. **(under review — see below)** |
| `span` | 1.0 | (last−first)/1e5 | Active lifespan, not just early arrival. |
| `survived_assets` | 2.0 | log | Created assets that found an audience (≥10 holders) — the core "real creator" signal. |
| `dividends` | 1.0 | log | Paid dividends to holders — pro-holder behavior. |
| `locked_assets` | 1.0 | log | Locked supply (can't rug) — commitment. |
| `btc_fees` | 1.2 | log | Lifetime BTC miner fees paid — real economic skin in the game. |
| `btc_spent` | 1.0 | log | BTC spent buying via dispensers — collector demand. |
| `dispense_btc` | 0.8 | log | BTC earned dispensing — merchant activity. |
| `assets_held` | 0.8 | log | Breadth of holdings — collector depth. |
| `xcp` | 1.0 | log | XCP held — protocol stake. |
| `pagerank` | 1.2 | log | **INACTIVE** — `rep_score` is never computed (always 1.0), so this is a constant ~0.83 baked into calibration, not a real factor. Reserved for graph-centrality; weight should go to 0 once anchors are recalibrated, or be implemented. |
| `modern_active` | +1.5 flat | bonus | Active into the modern chain (≥ block 900k) — not a long-dead address. |

### Proposed / new factors (wired, default weights — tune after the rebuild)
| factor | default weight | transform | why |
|---|---|---|---|
| `dex_trades` | 1.0 | log | DEX order-match participation — active market participant (was unrewarded entirely). |
| `stamps_created` | 0.8 | log | Bitcoin Stamp creation — recognize the stamp-builder cohort. |

---

## Address bands & tags

- **Bands** (on raw): `Established` ≥18.8, `Proven` ≥12.5, `Active` ≥8, else `Quiet` (old but idle) /
  `New` (genuinely recent). Infra overrides: `Exchange`, `Exchange deposit`.
- **Archetype tags** (descriptive, NOT score inputs): OG, Creator, Collector, Merchant, Whale, Burner,
  Stamp Creator, SRC-20 Deployer, Stamp Collector, BTNS User. Thresholds in `config.tag`.

---

## Asset quality score (new)

Assets currently have only a binary `low_quality`. We add a 0–100 **quality** score so assets can be
ranked, not just flagged. `raw = Σ weightᵢ · transformᵢ(signalᵢ)`:

| factor | weight | transform | why |
|---|---|---|---|
| `holders` | 1.5 | log | Real distribution breadth. |
| `trades` | 1.0 | log | Secondary-market depth (organic demand). |
| `durability` | 1.5 | (last−first trade)/1e5·… | Traded over a long span = enduring, not a flash. |
| `holder_breadth` | 1.0 | log | Avg holdings-depth of its holders (serious collectors hold it). |
| `pct_creator_holders` | 0.5 | linear/100 | Held by proven creators — peer validation. |
| `dispense_btc` | 0.5 | log | Real BTC commerce. |
| `low_quality` | −6.0 flat | penalty | Wash/bridge/curated junk — hard negative. |
| `thin_secondary_market` | −3.0 flat | penalty | **(proposed)** huge supply + thin trades-per-holder = weak SECONDARY liquidity. NOTE: dispenser sales are real BTC purchases (demand), so dispenser use is NOT the negative — only low secondary trading is. |

---

## Common methods & what "success" looks like

**Methods used / available:** weighted linear combination of log-normalized features (current); winsorizing
/ capping a dominating feature (candidate for `age`); percentile/rank normalization of the output (current);
recency weighting / decay (we use a flat modern bonus, could go continuous); hard classification gates for
infra; negative penalties for abuse. These are the standard toolkit for on-chain reputation.

**Success criteria** (how we judge a weight set):
1. **Face validity** — known-good actors (prolific artists, OG creators) land Established/Proven; known
   exchanges/scammers/dust-spammers do not. Keep a labeled spot-check list.
2. **Discrimination** — scores spread across the range; not all clustered at 0 or 100 (check the histogram).
3. **Gaming resistance** — cheap actions (dust sends, self-trades, minting 1000 dead assets) move the score
   little. Test by simulating a farm address.
4. **Stability** — a small data change (one more block) → a small score change. No cliffs except intended bands.
5. **Anchor calibration** — the percentile anchors (`pct.p50/p90/p99`) should match the *actual* population
   percentiles of `raw`. After any factor/weight change, re-read them from `/v2/reputation/review` and update.

**Tuning workflow:**
1. Edit weights/transforms in `src/reputation/config.ts`.
2. `wrangler deploy` (scores are computed at read time, so weights apply instantly — no signal rebuild needed
   unless you added a *new signal column*, which needs a `signals.ts` pass + rebuild).
3. `GET /v2/reputation/review` → raw-score distribution (p50/p90/p99/max), band counts, and top/bottom samples
   with per-factor breakdown.
4. Recalibrate `pct` anchors to the observed percentiles; spot-check the labeled list; adjust; repeat.

---

## Population analysis (2026-06-27, post full re-index)

First look with the NEW knowledge we lacked in prior experiments — vaults, stamps, SRC-20, BTNS — alongside
exchanges/deposits/burns. Of 464,488 addresses:

| cohort | n | avg held | avg DEX | stamps held | avg age (mo) |
|---|---|---|---|---|---|
| all | 464,488 | 2.6 | 0.9 | 0.2 | 75 |
| real user (no infra flag) | 411,534 | 2.8 | 1.0 | 0.2 | 74 |
| **deposit** | 28,114 | 0 | 0 | 0 | **113** |
| **emblem vault** | 24,702 | 1.4 | 0 | 0.1 | 52 |
| **stamp collector** | 15,895 | **28.1** | **5.6** | 5.9 | **37** |
| stamp creator | 10,573 | 11.2 | 1.3 | 4.5 | 36 |
| BTNS user | 4,057 | 12.8 | 3.1 | 1.2 | 43 |

**What it tells us:**
1. **Deposits & vaults are passive infrastructure** (53k addresses, ~11%): deposits are ancient (~9.5yr) with
   zero holdings/trading (pass-through); vaults hold ~1.4 assets and never trade (custody). Excluding them
   from "real holders"/reputation is well-justified — they'd badly distort holder counts and user views.
2. **Stamp/BTNS cohorts are the MOST engaged users but the NEWEST.** Stamp collectors hold 28 assets (10×
   average) and trade 5.6× average, yet average only 37 months old vs 74 for everyone else; only 285 of
   15,895 (~2%) are >5yr old.
3. **Clean cross-protocol structure:** 1,536 stamp-collectors are themselves Emblem vaults (stamps wrapped
   as NFTs); 234 are stamp-creator + BTNS power-users; ZERO deposit/stamp overlap (no misclassification).

**Implication for the model (evidence for the age-weight decision):** the `age` weight (2.0) structurally
**under-rewards the most engaged modern cohort** — a 2023 stamp collector with 28 assets + active DEX trading
scores below an idle 2014 address. The data supports **capping or lowering `age`** and leaning on the
engagement factors (`survived`, `held`, `dex_trades`, `stamps_created`). Candidate: cap the age term at
~3.0 (≈ blocks for ~5yr) and/or drop weight 2.0→1.0; then re-check `/v2/reputation/review` that engaged-new
cohorts rise into Active/Proven without idle OGs collapsing. (Not yet applied — tuning decision.)

## Lab experiments (2026-06-27, post re-index)

Hypotheses fired at the full index + signals. Method per the "success criteria" above.

| # | hypothesis | result |
|---|---|---|
| H1 | age dominates the reputation score | ✅ in the Established band (raw≥18.8, n=4,596), **67% of the score is age+span**; 77% are non-creators (survived=0) |
| H1b | …so idle-OG freeloaders pollute the top band | ❌ **only 16 of 4,596** are pure-age idle (survived=0 AND held<3 AND dex<2 AND no spend/div/dispense). The implicit engagement floor holds — to clear 18.8 you need real activity on top of age. |
| — | **reframe** | the defect is **false negatives, not false positives**: engaged-but-new cohorts (stamp collectors ~37mo) can't *reach* the top for lack of age points; idle-old don't pollute it. |
| H2 | winsorizing (capping) the age term lets engaged-new rise | ✅ cap age-term at 4.0 → top-4,596 non-creators 77%→71%, **436 stamp creators enter the top tier**; negligible downside (only 16 freeloaders existed). |
| H3 | the asset quality score discriminates good vs junk | ✅ PEPECASH **38.2**, RAREPEPE **27.0** (flagships near max 43); population mean **2.6**, min **−5** (low_quality penalty); 20,742 assets ≥8. |
| H4 | being in an Emblem vault predicts asset quality | ✅ vaulted assets (n=6,899): **79.7 avg holders / 44.9 trades / 12.35 quality** vs not-vaulted 4.4 / 0.8 / 2.15 (~18× holders). People only wrap good assets for ETH trading. → candidate asset factor `is_vaulted`. |
| H6 | mint-flooding games reputation | ❌ no exploit — 298 flooders (300+ issued, 0 survived) avg raw 10.3; flooding earns nothing (`assets_issued` isn't a factor; only `survived` counts). |

**Note on vaults:** a vault is a *custody container / ETH bridge*, not a person — one owner can control many vault boxes; the real collector is the off-chain NFT owner. So vault addresses are correctly excluded from *user* reputation; "stamps in vaults" = stamp assets sitting in vault boxes, not collector-people.

### More findings (2026-06-27 lab, round 2)
- **H11 — descriptions as a creator-intent / permanence signal** (we only used them for stamps/BTNS): of 252k assets — on-chain stamp/base64 **104,964**; blank 57,745; json 39,565; plaintext 30,602; **easyasset.art 9,509**; **imgur 5,780 (EPHEMERAL — link-rot risk)**; **arweave 2,412 + ipfs 1,175 (decentralized-permanent)**; ordinals 38. → candidate asset tag `art_storage` ∈ {onchain, arweave, ipfs, imgur(ephemeral), easyasset, json, url, plaintext, blank}; permanence is a quality/durability axis.
- **H12 — asset type profiles:** named 115,696 (13.5 holders / 3.6 trades — the real projects) ≫ subasset 13,740 (8 / 2.4) ≫ numeric 123,043 (1.8 / 0 — mass-mint stamps/SRC-20). Type is a strong prior.
- **H13 — GRAILS (surface the economically-real assets):** quality-score v0 top = XCP, PEPECASH, BITCRYSTALS… Raw holder count over-ranks assets with lots of PRIMARY dispenser sales but thin SECONDARY trading (PEPEONMUSK 1,931 holders / 539 trades = 0.28 trades-per-holder). NOTE: dispensers are paid vending (real BTC purchases), so those holders are genuine buyers — the asset has real primary demand, just weak secondary liquidity. A grail score should weight **secondary liquidity depth (trades-per-holder) + scarcity (supply) + BTC value (dispense price/volume + order value)** — dispense revenue counts as real demand. Headline project.

### Signal backlog (Dan brain-dump 2026-06-27 — to design/test)
ASSET-level:
- art_storage taxonomy (H11) — onchain/arweave/ipfs/imgur/easyasset/json/url/blank → permanence + tooling era.
- ownership changed over time (transfer issuances on an asset) — changed hands.
- supply changed over time (reissuance increasing supply) — inflation/mutation.
- named vs subasset vs numeric (H12) — type prior.
- collector-base breadth / variety (holder_breadth already; add Gini/concentration).
ADDRESS-level:
- broadcaster classification: data-feed/oracle vs BTNS vs plain message (split BROADCAST text).
- raw send COUNT (we have out_peers=distinct dests, not total sends).
- orders vs order_matches RATIO (fill rate — intent vs execution).
- dispenser stats: count, prices, dispenses, sell-through.
PROJECT:
- GRAILS (H13): desirable/liquid/economically-justified assets — liquidity×scarcity×value, distinct from the curated named-collections we exclude. Surface the grails algorithmically.

### Hypothesis board — next experiments
- **H5 — thin secondary market:** huge supply + low trades-per-holder = weak secondary liquidity → codify as an asset negative (dispenser sales are real demand, so NOT part of this — only weak DEX trading is).
- **H7 — protocol quality profiles:** classic STAMP vs SRC-20 vs SRC-721 vs Rare Pepe quality distributions — distinct?
- **H8 — wash detection:** does `self_trade_pct` actually catch fake volume (cross-check vs known wash assets)?
- **H9 — archetype clustering:** do real clusters exist (true-OG-creator / modern-power-user / whale / flipper / wash-trader)?
- **H10 — apply + measure:** age-cap (winsorize ~4.0) and add `is_vaulted` to asset quality; read `/v2/reputation/review` before/after.

## Display — tiers, not false precision (v1, 2026-06-28)

The 0–100 number is a heuristic percentile, so we **lead with a coarse, named tier** and keep the number as
detail. Tiers are cut on the raw score at exact percentiles of the **market population** — the 22,826 assets
that ever traded or dispensed. Ranking against *that* population (not all 252k) is deliberate: ~132k assets
are held but never traded and ~98k have no holders; including them would make every score meaningless. Those
get honest non-ranked states instead of a misleading low number.

| tier | cut | meaning | count |
|---|---|---|---|
| **Bluechip** | top ~1% of market assets | deep, durable, broadly-held | ~250 |
| **Established** | top ~10% | sustained real trading + distribution | ~2,000 |
| **Active** | upper half | a functioning secondary market | ~9,000 |
| **Speculative** | rest of market | has a market but thin / early | ~11,000 |
| **Untraded** | held, never traded/dispensed | issued + held, no market | ~132,000 |
| **Dormant** | no holders | never developed a market | ~98,000 |

Addresses get the same treatment (2026-06-28), ranked against the **349,499 real users** (infra + passive
throwaways excluded from the denominator): **OG** (top ~1%, raw≥20) · **Established** (top ~10%, ≥12.7) ·
**Active** (upper half, ≥5.8) · **Casual** (rest). Non-ranked states carry their own honest label:
**Exchange / Exchange deposit / Vault / Burn / Service** (infrastructure) and **Dormant** (no real footprint).
Every tier+state ships a `tier_meaning` in the API. This retired the old vague `Proven` honorific.

## Threat model — it's open source, assume the weights are read

Design rule: **the heaviest weights must require costly or hard-to-fake action.** Audit of the asset factors:
- **durability** (heaviest, 2.0) — a long trade span is cheap to fake with two wash trades years apart, so it
  is **gated by distinct traders** (`span × dt/(dt+3)`): longevity only counts to the extent *real distinct
  people* sustained it. Verified: bluechips (thousands of traders) unaffected; two-trader spans collapse.
- **distinct_traders / trades_per_holder** — require genuine counterparties; wash inflates `trades` but not
  distinct addresses, and `self_trade_pct` penalizes wash directly. Raw `trades` is therefore demoted.
- **holders** — cheapest to inflate (send to sybils), so it is light. (We tested the "airdrop" worry and it
  was a non-issue — the suspected assets got holders via *paid* dispensers, not free sends.)
- **burned_pct** costs real supply to fake; **dispense_btc / btc_fees** cost real BTC. Costly = trustworthy.
Residual: a determined sybil with real BTC can still move the needle — but every lever costs money or
counterparties, and tiers are coarse so small manipulations don't change the tier. That's the honest bar.

## Open decisions
- **age weight (2.0):** an OG with no activity can still score high. Options: cap the age term (winsorize),
  lower the weight, or require a minimum earned-signal floor for high bands.
- **pagerank:** drop the dead term (and recalibrate) or implement real personalized PageRank over `pr_edges`.
- **social-attention signal:** the Telegram mention count (cross-chat filtered) could become its own
  "community favorite" tag — distinct from on-chain quality (score↔mentions Spearman ≈ 0.30).
