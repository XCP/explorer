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
| `vault_scams` | −2.0 | log | **PENALTY (2026-07-07)** — the only explicit bad-actor demerit. Counts distinct Emblem vaults this BTC address *cracked* (sent/swept the wrapped card out) that were then **resold empty**. Cracking to redeem your own card is fine — the signal requires a POST-crack sale, so honest redeemers score 0. Scope: only Counterparty-funded vaults have an on-chain crack; the *other* Emblem scam shape — vaults minted empty that just claim a card (`trades.sale_class='scam_empty'`) — is an ETH-side mint with **no BTC actor to score**. Currently flags ~0 (the crack-then-resell pattern is essentially absent in the data; see the Emblem vault classification below). |

### Emblem vault sale classification (2026-07-07)
Emblem is multi-chain; we index Counterparty. `indexer/vault-contents.ts` (on-chain: sends/balances/sweeps)
+ `indexer/emblem-meta.ts` (Emblem `/meta`: claimed name vs actual contents) classify every vault sale
into `trades.sale_class`: **real** (single CP card, full at sale — the only class attributed to an asset,
now with true unit quantity), **bundle** (multi-CP), **scam_cracked** (card sent/swept out before the sale
— ~0 observed), **scam_empty** (name claims a real CP card but the vault holds nothing on any chain — the
minted-empty shells), **non_counterparty** (value genuinely on another chain — Namecoin/Ordinals/BTC — NOT
a scam, just invisible to our Counterparty view). The realized-USD asset signals now count only `real`.

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
cohorts rise into Active/Proven without idle OGs collapsing. **APPLIED 2026-07-06:** age TRANSFORM winsorized at
`SCALARS.addrAgeCap = 4.0` (weight kept at 2.0), in both the TS scorer and rawSqlExpr. Live isolation over the
261,746 real-user population (tip 956,949): the cap reduces raw for only 3,113 of the oldest addresses and moves
just 932 across a tier boundary — the negligible downside H2 predicted. Anchors recalibrated (see below).

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

### Realized-value re-dial (2026-06-28) — the grail-vs-scam-pepe fix
Symptom: high-issuance Rare Pepes that were Emblem-vaulted and pumped on Ethereum-as-a-scam were ranking
**Bluechip**. Root cause (found by validating against live prod data, not theory): they score high on the
**popularity family** — durability (a long *active* span), distinct traders, holders, current activity — all of
which sustained pumping inflates. The clean discriminator is **realized economic value**: real Rare Pepe grails
were *sold for real BTC/XCP* (value_btc 1.0–4.6, value_xcp 4.4–5.7), whereas the scam pepes have **value_btc ≈ 0**
and only modest value_xcp despite huge activity (their "value" lived on the ETH side, invisible to Counterparty).
- **Fix:** realized value now DOMINATES (`max_dispense_btc` 1.5→4.0, `max_trade_xcp` 0.6→1.8, `dispense_btc`
  0.5→1.0, `distinct_dispensers` 0.6→1.0) and the popularity/recency family is trimmed hard (`__durability`
  2.0→1.0, `distinct_traders` 1.5→0.9, `recent_events` 1.2→0.3, `holders` 1.0→0.4, `trades` 0.5→0.2,
  `holder_breadth` 1.0→0.6, `__asset_age` 1.0→0.7). Bluechip now means **"people paid real money for this"** —
  which is also the most gaming-resistant definition (you cannot fake spending BTC).
- **Validated** on a 12-asset convergent set: all 4 strong grails (SATOSHICARD 55.7, RAREPEPE 55.3, FDCARD
  52.2, DARKPILLPEPE 48.5) clear every scam pepe (top scam 41.9) — margin **+6.6**. The only grail left low is
  WINKELPEPE (supply 2, ~no trades): a genuine ultra-rare 1/1 that no behavioral signal can separate from a
  dead asset (the known series-directory limitation).
- **Rejected first:** a *supply-scarcity penalty* (dock high whole-unit supply on indivisible assets). It was a
  leaky proxy — it hit legit assets (BITCORN, NINJASUIT) while missing the 1000-supply pepes (TREEOFPEPE,
  RGBPEPE) and the divisible one (TESTNETPEPE). Supply ≠ the thing; *realized value* is.
- **Circulating-scarcity (added + validated 2026-06-28, Dan's idea):** `__circulating_scarcity = 3.5 −
  log10(circulating supply)`, where **circulating = supply_normalized × (100 − burned_pct)/100**. Uses
  CIRCULATING not issued supply — the key fix: NINJASUIT issued 21M but burned ~100% → circ ~198, correctly
  scarce (raw issued supply wrongly flagged it; that earlier attempt was rejected). Rewards genuine scarcity,
  penalizes printed supply; legit high-demand currencies (PEPECASH, BITCRYSTALS) survive the penalty because
  their realized demand carries them. Needs `asset_signals.supply` (migration 0019, seeded by `asset_seed`).
- **Calibrated + DEPLOYED 2026-06-28** against the full 22,824 market-asset population: `ASSET_PCT`
  {p50:11.68, p90:22.01, p99:36.64, max:56.87}. Tiers: **Bluechip = raw≥45 (top ~0.1%, ~19 assets)** — set
  TIGHTER than p99 on purpose so it's genuinely elite and excludes the knockoffs that cluster 36–42 just under
  it; Established=22.01, Active=11.68. Live-verified: the 6 clear grails are Bluechip; all the scam pepes
  (PEPEONMUSK/TREEOFPEPE/RGBPEPE/CULTOFPEPE/TESTNETPEPE/PEPEREPUBLIC) are Established.
- **Honest separability limit:** NINJASUIT (a grail) and RGBPEPE (a scam) score nearly identically (~42) —
  objective on-chain signals can't tell a 1000-supply knockoff from a thin grail, so NINJASUIT/WINKELPEPE land
  Established. No cutoff puts ALL curated grails in AND ALL scams out; we optimize for "scams not Bluechip".
- **Watch (over-indexing):** a few thin-holder assets (PEPEMILLION, TECHNOPEPE) ride a single large `value_btc`
  dispense into the top — a whale self-dispensing at a high ask could game it. Future: a clean/distinct-buyer
  guard on realized value (we have it for DEX via self_trade_pct; not yet for dispenses).

## Scoring Phase A (2026-07-06)
- **Age cap APPLIED:** the address age transform is winsorized at `SCALARS.addrAgeCap = 4.0` (≈7.6yr), pre-weight,
  in both score.ts and rawSqlExpr (parity is enforced by the reputation tests, which re-derive the cap from config).
- **Dead pagerank factor REMOVED:** the never-computed `rep_score`/pagerank factor (weight 0.0 since inception) was
  deleted from `ADDRESS_FACTORS`. The `address_signals.rep_score` column is kept in case personalized PageRank returns.
- **Address anchors recalibrated** to the capped raw over the real-user population (n=261,746 @ tip 956,949):
  `ADDRESS_PCT`/`ADDRESS_TIERS` p50 2.5→2.88, p90 4.7→5.22, p99/OG 17.5→16.33, max 53→51.15 (the cap compressed the top).
- **New guard endpoint** `GET /v2/reputation/asset-validation`: vaulted-tagged vs non-vaulted market assets, count/mean/median
  of the raw quality expr + `lift`. Live: vaulted mean 21.6 (n=4,801) vs non-vaulted 9.8 (n=18,048) → **lift 2.20**.
  NOTE: below the ≥2.5 watch line — an artifact of the 2026-06-28 realized-value re-dial (which de-emphasized the
  popularity signals vaulting correlates with), not a regression; revisit if it drifts further.

## Scoring Phase B — USD realized-value lead (2026-07-06)
The 06-28 re-dial made realized value dominant but measured it **per rail** (`max_dispense_btc` for BTC dispenses,
`max_trade_xcp` for XCP DEX trades) — so a grail sold for **ETH on Emblem** counted as ~0 realized value, and
`max_dispense_btc` was **gameable** (a whale self-dispensing at a high ask, the Watch item above). Phase B fixes both.

- **New signals** (migration 0023 + three `signals.ts` feature units; populated in prod): `max_realized_usd` (largest
  single sale's `usd_value` across ALL venues dex|dispense|emblem — currency-agnostic worth), `max_dispense_btc_clean`
  + `distinct_dispense_buyers` (dispense value/buyers with self-dispenses `source=destination` **excluded** — the
  clean/distinct-buyer guard the 06-28 Watch note called for), `emblem_trades` (ETH-side sale count). Trades-ledger
  units carry a documented one-tick lag (they read `trades`, materialized after the cascade; the full-rebuild self-heals).
- **Factor re-dial (`ASSET_FACTORS`):** `max_realized_usd` is the new PRIMARY realized-value anchor (log, **4.5**);
  the gameable `max_dispense_btc` (4.0) is **replaced** by `max_dispense_btc_clean` and demoted to 0.5 under the same
  `value_btc` label; `max_trade_xcp` 1.8→0.5; `dispense_btc` 1.0→0.5; added `distinct_dispense_buyers` (0.8) and
  `emblem_trades` (0.4). All plain `log` transforms (no special handling; parity holds in score.ts + rawSqlExpr).
- **Anchors recalibrated** (22,849 market assets @ tip 956,949): the USD-led model (log of a $-value) lifts the raw
  scale ~2.7×. `ASSET_PCT` p50 11.68→**30.84**, p90 22.01→**52.49**, p99 36.64→**71.74**, max 56.87→**105.52**, floor 1→5.
  `ASSET_TIERS` Established/Active = p90/p50 (52.49 / 30.84). **Bluechip 45→93** (see below).
- **Bluechip = raw≥93 (8 assets, top ~0.035%).** Under the USD lead the 85–93 band mixes real broadly-held assets
  (SARUTOBICARD 771 holders, LORDKEK 760) and thin real grails (NINJASUIT) with **thin single-large-sale whales**
  the USD term floats up (PEPEMILLION 5 holders/$896k, GRIMPEPE, TECHNOPEPE — the documented gaming vector). raw≥93
  is the clean break ABOVE that whale cluster (tops out ~91): the 8 there — PEPECASH, XCP, SATOSHICARD, FDCARD,
  RAREPEPE, BITCRYSTALS, SHITCOINCARD, DARKPILLPEPE — are all unambiguous. **Cost:** thin real grails (NINJASUIT 85.1)
  land top-of-Established, not Bluechip (accepted per "optimize scams-not-Bluechip, not all-grails-in").
- **Grail validation — margin IMPROVED to +16.1** (was +8.1): the 4 strong grails (SATOSHICARD 100.9, FDCARD 99.4,
  RAREPEPE 97.6, DARKPILLPEPE 93.1) clear the entire scam set (PEPEONMUSK 77.1 the top scam) by 16.1 — grails sold for
  $358k–$629k realized vs the scams' $3k–$7k. w=4.5 **maximizes** this margin (lowering it shrinks separation).
  The thin grails NINJASUIT (85.1) / WINKELPEPE (79.2) stay Established — the honest series-directory separability limit.
- **Vaulted lift DROPPED 2.20→1.66 — a mean-RATIO artifact, not a regression.** The shared USD term adds a large ~common
  offset to every market asset, compressing the ratio while ABSOLUTE separation stays healthy: vaulted mean **48.6** /
  median 48.9 (n=4,801) vs non-vaulted **29.3** / median 28.8 (n=18,048) — a **+19–20 raw** gap. Under a realized-value-
  dominant model, absolute/median separation is the better convergent-validity gauge than the mean ratio; the `lift`
  watch-line (≥2.5) should be read with that caveat (or the endpoint switched to report the median gap).
- **Watch / follow-ups** — items (1) and (2) below are now IMPLEMENTED; see "Buyer gate + hard low-quality cap" further down.
  (1) [RESOLVED] the thin single-large-sale whales (PEPEMILLION etc.) are still floated into the top of
  Established by one big `max_realized_usd`; the true fix is a **distinct-buyer GATE on realized value** (like
  durability's `dt/(dt+3)` trader gate) so a single sale with ~no distinct buyers can't dominate — a new `__special`
  factor, deferred. (2) [RESOLVED via hard cap] **the flat `low_quality` penalty (−6) is now demonstrably under-powered on the ~2.7× scale:**
  curated-junk **OXBT** (`low_quality=1`, a bridge token — 0 DEX trades, 18.7k dispenses, $9M realized, 15k holders)
  still lands **Established at raw 85.2** — a wash/bridge asset in the top ~10%. A bigger additive constant can't fix
  this cleanly (it'd need ≈−60 to sink OXBT below Active, which would over-punish borderline assets); the right fix is
  a **hard gate** — treat `low_quality=1` like infra addresses and force a non-ranked/Speculative-capped tier in
  `assetTier()`, independent of raw. Deferred (touches display semantics, out of the Part-2 weight scope). (3) verify
  PEPEMILLION's 16-BTC "clean" dispense isn't a two-address wash defeating the `source≠destination` guard, or a
  price-backfill artifact.

### Origin-aware dispenser attribution (Phase B addendum, 2026-07-06)
Protocol fact: a creator A can open a dispenser AT an empty address B (`dispensers.origin=A`, `dispensers.source=B` —
the dominant modern pattern; 42,473 of 101,907 prod dispensers are origin≠source). Both the asset self-dispense guard
and the address merchant attribution keyed on the wrong address; corrected via a PK-seek join to `dispensers`.
- **Asset guard hardened.** `asset_dispense_buyers` now excludes `destination = COALESCE(dp.origin, d.source)` on top
  of `destination = d.source`, so an origin self-buy (A opens at B, A buys from B — source=B≠dest=A passed the old
  filter) no longer counts as a buyer or a clean-max. Impact on the score is negligible: only a few origin self-buys
  drop out (SATOSHICARD 67→66 buyers, FDCARD 19→18; `max_dispense_btc_clean` unchanged everywhere in the spot-check),
  raw shifts ≤0.04, so the **grail margin (+16.1) and vaulted lift hold** — those are USD-term-dominated and the USD
  term is unaffected. (The stored `distinct_dispense_buyers`/`max_dispense_btc_clean` columns stay pre-hardening until
  the next full rebuild; the numbers above are the on-the-fly hardened re-computation, read-only.)
- **Merchant attribution moved to the creator.** `addr_disp_earn` (`dispense_btc`/`dispenses`), `addr_disp_trust`
  (`disp_trust`), and `addr_clean_disp` (`clean_dispense_btc`, changed for consistency — it would be incoherent to
  attribute the two merchant-revenue columns differently) now credit `COALESCE(origin, source)` = the human operator,
  not the throwaway dispenser B. Buyer-side columns (`btc_spent`, `clean_btc_spent`) are unchanged (the buyer is real).
- **Address anchors need a POST-DEPLOY re-check — flagged, not recomputed.** The reattribution consolidates 53,827
  source-addresses into **21,548 real operators**, and **22,290 currently-ranked addresses** hold source-attributed
  `dispense_btc` that moves to a creator (~8.5% of the ~261k real-user population) — too large to treat as noise. It
  can't be measured read-only because prod columns are still source-attributed; recompute `ADDRESS_PCT` from
  `/v2/reputation/review` AFTER the rebuild repopulates origin-attribution.
- **Two deploy caveats (self-healed by the full rebuild, documented in signals.ts):** (1) `dirtyAddrs` derives only
  dispenser `source`/`destination`, not `origin`, so the per-block cascade won't refresh a creator A when a buyer hits
  A's dispenser — the full rebuild re-attributes each cycle; closing it means adding origin to `dirtyAddrs`. (2) The
  origin-keyed `.full` doesn't reset throwaway-B rows that hold a stale source-attributed value from before the change —
  a one-time `UPDATE address_signals SET dispense_btc=0,dispenses=0,disp_trust=0,clean_dispense_btc=0` at deploy clears
  them before the rebuild.
- **Related, not changed:** `distinct_dispensers` (asset breadth, weight 1.0) still counts distinct dispenser *sources*,
  so a creator opening N empty-address dispensers reads as N operators — the same origin-vs-source over-count. Out of
  the addendum's scope; flagged for a follow-up if breadth needs to reflect distinct operators.

### Buyer gate + hard low-quality cap (Phase B FINAL, 2026-07-06)
The two Watch follow-ups above are now IMPLEMENTED (commit "Scoring Phase B final"), closing the thin-whale vector and
the under-powered-penalty problem:
- **Distinct-buyer GATE on realized value.** `max_realized_usd` is replaced by `__realized_usd` = log(USD) value ×
  `B/(B+3)`, where `B = distinct_traders + distinct_dispense_buyers` — mirroring `__durability`'s trader gate. A single
  huge sale to 1–2 buyers is heavily damped; broad demand passes at ~full strength. Wired in BOTH `factorValue` and
  `rawSqlExpr` (weight 4.5, the primary value factor). Effect on the thin-whale set (read-only, gated expr):
  PEPEMILLION 90.9→75.4, GRIMPEPE 86.6→75.0, TECHNOPEPE 86.4→77.6 — all sink into the scam band on buyer-thinness
  alone. DEXTERPEPE resists (91.5→87.9): it has ~43 real DEX traders (B≈46), not a thin whale.
- **Hard low-quality tier cap.** `assetTier()` now takes `lowQuality` and returns Speculative regardless of raw —
  low_quality is a CLASSIFICATION, not a score component (parallel to the infra address states). This is the fix the
  Watch note called for: on the Phase-B scale the flat −6 penalty can't demote (OXBT rode $9M of flow to raw 85), so
  the cap does the tiering. The −6 penalty is KEPT but now only orders raws among low_quality assets.
- **PEPEMILLION (Watch item 3) — investigated, resolved.** NOT an origin-wash: its two big dispenses (16 BTC ≈ $896k,
  15 BTC) go to genuinely distinct buyers (destination ≠ dispenser source, ≠ origin, ≠ issuer). The hardened origin
  guard doesn't touch it; the distinct-buyer GATE is what correctly demotes it (2 dispense buyers + ~7 traders → B≈9,
  gate 0.75 → raw 90.9→75.4). (Off-chain collusion between those buyers can't be ruled out from the mirror, but it is
  not the on-chain self-deal shape.)
- **FINAL calibration** (gated expr, 22,849 market assets @ tip 956,949): `ASSET_PCT` p50=20.19, p90=45.86, p99=68.73,
  max=105.48 — the gate pulls the mid DOWN vs the ungated read (thin-buyer assets lose most of the USD term); the
  broad-demand top is barely touched. `ASSET_TIERS` Bluechip=**92** (7 clean elite assets — a clean break in the
  4.4-pt gap between SHITCOINCARD 94.0 and DARKPILLPEPE 89.6; the grail DARKPILLPEPE lands top-Established, honest for
  its thin ~48-buyer base). Established/Active = p90/p50.
- **Validation (post-gate):** grail margin **+12.7** (the 4 strong grails ≥89.6 clear the scam set ≤76.9 — lower than
  the pre-gate +16.1 because the gate also trims grails and the popularity-scam PEPEONMUSK has a high B, but now
  gaming-resistant). Vaulted lift RESTORED by the gate: mean-ratio 1.66→**2.18** (≈ the old 2.20 baseline), median-gap
  **+25.2** (vaulted median 42.2 vs non-vaulted 17.0) — the gate removed the shared USD offset that was compressing the
  mean ratio. `/v2/reputation/asset-validation` now reports BOTH, with median-gap the primary gauge.

## Open decisions
- **age:** further options if longevity still over-rewards — lower the weight below 2.0, or require a minimum
  earned-signal floor for high bands (the cap addresses the dominant case).
- **pagerank:** implement real personalized PageRank over `pr_edges` to revive the reserved `rep_score` column.
- **social-attention signal:** the Telegram mention count (cross-chat filtered) could become its own
  "community favorite" tag — distinct from on-chain quality (score↔mentions Spearman ≈ 0.30).

### Phase B round 3 — the buyer gate, the tier gate, and origin-aware attribution (2026-07-06, final)

- **`__realized_usd` buyer gate**: the primary USD factor is now `ln(max_realized_usd) × B/(B+3)`,
  B = distinct_traders + distinct_dispense_buyers — mirrors `__durability`'s trader gate. Validation:
  PEPEMILLION ($896k, 2 buyers — verified legit-but-thin, NOT origin-wash) fell 90.9 → 75.4, into the
  scam band on buyer-thinness alone. The gated top breaks cleanly at 94.0 (seven unambiguous assets);
  Bluechip = raw≥92.
- **`low_quality` hard tier gate**: `assetTier()` caps flagged assets at Speculative regardless of raw
  (OXBT: raw 85.2, $9M bridge flow — now Speculative, not Established). The −6 additive penalty remains
  only to order raws; the gate is the demotion mechanism.
- **Origin-aware everywhere**: dispense-buyer guard excludes `destination = COALESCE(origin, source)`;
  merchant revenue (dispense_btc/dispenses/disp_trust/clean) attributes to the creator
  `COALESCE(origin, source)`; `distinct_dispensers` counts operators not throwaway addresses; and
  `dirtyAddrs` now derives dispenser origins so creator signals stay per-block fresh.
- **Final anchors** (gated expr, 22,849 market assets @ tip 956,949): p50 20.19 / p90 45.86 /
  p99 68.73 / max 105.48. Grail margin +12.7 (strong-grail min DARKPILLPEPE 89.6 vs top scam
  PEPEONMUSK 76.9). Vaulted separation: mean 42.4 vs 19.5 (gap +22.9, ratio 2.18 ≈ baseline) — the
  validation endpoint now reports `median_gap` as the primary gauge.
- **Deploy ops**: one-time orphan reset of source-attributed merchant columns before the rebuild;
  ADDRESS_PCT re-check after re-attribution populates.
