# xcp.io — Reputation & Trust (intrinsic, no curation required)

Goal (per Dan): surface **who the OGs are** and what's trustworthy, using only on-chain graph +
behavior — **no dependence on collection tags or manual blocklists**, so it's always useful and
self-updating. Curated data (xcpdex `tags`, the `hidden` flag) is used only as *ground truth to
validate against*, never as an input.

Ground truth found in xcpdex DB:
- `pair_stats.hidden` / `dispenser_stats.hidden` — the "Hide low quality" blocklist. Only **57
  pairs** flagged, almost entirely **manual** (migration hardcodes OXBT/ORDIPEPE/OGPASS; rest by hand).
- Hidden pairs avg **794 trades / 162 traders**; visible avg **12 / 11**. "Low quality" = *fake/wash
  volume*, not low activity.

---

## Signal 1 — Wash / fake-volume score (intrinsic)  ★ VALIDATED
**trades-per-unique-trader** = total_trade_count / unique_traders.
- Legit pairs ≈ 1.1; wash pairs ≈ 5–95.
- Top-40 by ratio (≥50 trades): **16 already on the manual blocklist**; the rest (TASX 89/2,
  NAJBEZ 118/3, MYBLT 220/7) are misses the manual list never caught.
- Strengthen with: maker==taker self-trade fraction, # distinct counterparties, holder count vs
  trade count, time-clustering of trades (bursts). Reproduces the blocklist AND extends it, for free.

## Signal 2 — Organic adoption / distribution health (intrinsic, per-asset)
- **Holder count** and **top-10 % of supply** (concentration). High concentration + high volume = suspect.
- Distribution breadth: # distinct addresses that ever received it; dispenser buyers vs DEX traders
  vs direct sends. Organic = many independent recipients.

## Signal 3 — OG / address reputation (intrinsic, per-address) — the headline feature
Combine, all from the graph/behavior (no tags):
- **Tenure** — first-activity block (older = more OG). Strong, cheap.
- **Inbound diversity** — count of *distinct* addresses that have credited/sent to you. Each distinct
  sender ≈ an organic vote (Dan's "credits = votes"). Distinct-sender count resists wash (self-sends
  add nothing). This is the core organic-reputation primitive.
- **Commerce track record** — dispenser BTC volume + dispense count + longevity, no anomalies.
- **Maker history** — DEX trades as a real counterparty (distinct partners, not self).
- **Issuer signal** — # assets issued that are *locked* (can't rug) + dividends paid (rewards holders).
  Intrinsic (locked/dividends are on-chain facts, not curation).
- **Identity merge via sweeps** — collapse swept-together addresses into one entity before scoring
  (the lineage feature already surfaces these edges).

## Signal 4 — Seeded trust propagation (PageRank / EigenTrust) — the experiment Dan asked for
Directed graph: edge sender→receiver weighted by # distinct sends (or BTC value). Run personalized
PageRank. "Personalization vector" can be **intrinsic seeds** (oldest + highest distinct-inbound
addresses) rather than curated ones, keeping it collection-free. Trust flows: receiving from
high-rank addresses raises yours. Sweep edges = full trust transfer (same owner). Precompute as a
batch job; store one `reputation` score per address. (Distrust variant: propagate negative weight
from high-wash-ratio actors.)

---

## Approaches to try (Dan: "a few different approaches, see what comes out")
1. **Pure tenure + distinct-inbound** (dead simple, explainable). Expect: recognizable OGs on top.
2. **Behavioral composite** (Signal 3 weighted sum). Tunable weights.
3. **Personalized PageRank** (Signal 4) seeded intrinsically. Compare ranking to #1/#2.
4. **Wash score** (Signal 1) as the negative axis — an "areas of distrust" overlay.
Validate each against ground truth: OGs should include known creators; high-wash should overlap the
`hidden` blocklist. Then pick what produces the most sensible top/bottom and surface a reputation
chip/gauge on the address page (and a quality badge on assets).

## Experiments — what actually came out (2026-06)
Ran v1 OG score + aggregate holder quality. Findings:
- **OG score (positive-only) works** — surfaces real project issuers (dividends + locked issuance:
  1PH4Kz 516 divs/44 locked, 1Mafiam 310 divs, 1CkXN3 2417 locked) and OG/early addresses
  (1XCPdWb, 1SJCX). BUT raw `out_peers` is linear → exchanges/services (18k peers) dominate. **Fix:
  log-compress every count** so issuer/commerce signals aren't drowned by sheer volume.
- **Mud-resistance confirmed**: the score reads ZERO inbound signals, so being dusted with junk
  assets cannot change it. Reputation is only ever *earned*, never *lost from others' actions*.
- **Tenure-based "% OG holders" is CONFOUNDED** — wash assets (DIAMONDBOND 41%, RESORTLIFE 50%) score
  high because washers are often early/sophisticated. Tenure ≠ healthy cap table. Discard as a quality proxy.
- **`avg_holder_peers` (connectivity) is the honest discriminator** — RAREPEPE holders avg **50**
  distinct peers (real community) vs 7–23 for others. Plus **holder count** as a floor (RESORTLIFE = 4).

### Resulting model: TWO independent axes (don't collapse into one number)
1. **Trading integrity (asset-level)** — wash ratio (trades-per-unique-trader) + self-trade fraction.
   Answers "is the volume real?" Maps to the `hidden` blocklist intrinsically.
2. **Community strength (asset-level, aggregate, non-creepy)** — holder count + holder connectivity
   (avg distinct peers) + distribution breadth. Answers "is the cap table real/established?" THE
   fairmint use case ("quality of the other holders").
3. **OG reputation (address-level, positive-only, log-scaled)** — tenure + log(distinct peers you
   initiated) + log(dispense BTC) + log(dividends) + log(locked issuances) + PageRank trust-inflow.
   Shown only as a positive badge ("Established / OG"); never a negative brand. Default = neutral "new".

At-a-glance UI signals: asset → a community-strength gauge + a trading-integrity flag; address →
positive OG/established badge + tenure + connection count (no scarlet letters).

## Signal validation — feature matrix (guess-and-check, NOT productized yet)
All metrics below are PROVISIONAL. Approach: build a feature matrix over labeled assets
(legit-liquid: PEPECASH/RAREPEPE/BITCRYSTALS; wash: DIAMONDBOND/RESORTLIFE/TROPTIONS/PANDAGOLD) and
see which signals actually separate them before deciding anything is shown.

| asset | trades | traders | self% | toppair% | t/trader |
|---|---|---|---|---|---|
| PEPECASH | 52859 | 3000 | 0.5 | 0.3 | 17.6 |
| RAREPEPE | 258 | 144 | 0 | 1.2 | 1.8 |
| BITCRYSTALS | 12077 | 1528 | 0.4 | 1.1 | 7.9 |
| DIAMONDBOND | 2715 | 53 | 0.6 | 5.9 | 51.2 |
| RESORTLIFE | 478 | 5 | 97.7 | 95.8 | 95.6 |
| TROPTIONS | 2481 | 69 | 90.7 | 57.6 | 36 |
| PANDAGOLD | 208 | 8 | 82.2 | 74.5 | 26 |

Learnings:
- **`trades_per_trader` ALONE is a false-positive trap** — flags PEPECASH (legit blue-chip) as wash.
  Discard as a standalone signal.
- **`self_trade_fraction` (tx0_address == tx1_address) is the clean wash detector** — ~0% for all
  legit-liquid, 80–98% for blatant wash, zero overlap. Intrinsic, cheap.
- DIAMONDBOND washes via a 2-address RING (self% only 0.6%), caught by `traders` being tiny (53) vs
  trade count + elevated top-pair concentration. So: wash ≈ `self% high` OR `(few distinct traders
  AND high top-pair concentration)`.
- Open question to test next: trader-graph clustering (do the few traders form a closed ring?), and
  whether dispenser-side wash needs a parallel signal.

### Self-trade signal validated at scale (vs blocklist ground truth)
Ranked ALL assets (>=50 trades) by self-trade %. Distribution is bimodal: a wash cluster at **70–98%**
(NAJBEZ 98, RESORTLIFE 98, MYBLT 91, TROPTIONS 91, PANDAGOLD 82, MEAT 71), then a cliff to <16%.
Threshold ~50%. Cross-checked vs xcpdex `hidden`: RESORTLIFE/TROPTIONS/PANDAGOLD already flagged ✓;
NAJBEZ/MYBLT/MEAT NOT flagged = misses the manual list never caught. → intrinsic signal reproduces +
extends the blocklist (self-updating). Caveat: `hidden` is per-PAIR; group wash detection per pair,
not per base_asset (DIAMONDBOND's wash hides in one pair). Ring-wash (low self%, few traders, high
concentration) is a SEPARATE detector still to formalize.

### OG / positive reputation — log-scaled, VALIDATED (address-level)
score = (955000-first_block)/100000 + LN(1+out_peers) + 1.5·LN(1+dispense_btc) + 1.5·LN(1+dividends)
        + LN(1+locked_assets_issued).  (D1 has LN().)
Log-compression fixes v1's service-domination (raw out_peers let an 18k-peer exchange win). Top-18 are
now all genuine creators (1GotRej 1909 assets/320 locked/144 divs; 1AwS3wR 1339/486; 1PH4Kz 516 divs).
**Cross-validation:** 1GotRej/1A62aP/1AwS3wR are the same addresses found as top curated-collection
issuers earlier — but this score uses ZERO collection data. Intrinsic signal independently
rediscovers known creators. Mud-resistant (no inbound terms). This is the headline positive signal.
Next: add PageRank trust-inflow term; test weight sensitivity; entity-merge sweep-linked addresses.

### Trust-inflow / PageRank (address-level) — promising, 1-hop prototype
Computed dust-proof without global iteration: a target's senders are a small set, so score THEM and
aggregate. Two metrics, capturing different things:
- `trust_inflow` = Σ sender_rep over distinct senders = **PageRank iteration-1 (weighted in-degree)**.
  Rewards popularity (18PHGKz 2998, 1GotRej 2308). Game-able by volume.
- `avg_sender_rep` = **reputation BY ASSOCIATION** — the quality of who chose to transact with you.
  1Mafiam scored highest (8.83) with only 20 senders: few but reputable. Un-gameable (can't make OGs
  send to you), dust-proof (junk senders ≈ 0 rep → don't move the average). THE novel signal here.
Caveat: 1-hop with a crude sender-rep (tenure+ln(peers)). Next: true power-iteration PageRank so
trust propagates multi-hop; and a labeled DUSTED address to prove avg_sender_rep stays low under dusting.

UPDATE — dust-resistance requires OUT-DEGREE NORMALIZATION (the real PageRank trick): each sender's
vote = rep(sender) / outdegree(sender). Verified: norm-inflow ranks OGs correctly (18PHGKz 90.6,
1GotRej 67.5, 1Mafiam 12.7). Dust-proof proven analytically: mass-sender 12GvsmiN (10,001 recipients,
rep≈14.5) adds 14.5 to RAW inflow per victim but 14.5/10001≈0.0014 to NORMALIZED inflow → dusting is
worthless. avg_sender_rep WITHOUT outdeg-normalization is NOT dust-proof (old spammers still score);
the /outdeg division is mandatory. This is PageRank iteration-1; full power-iteration is the extension.

## COMBINED FRAMEWORK (the synthesis — "something that makes sense and is of value")
Reputation = two POSITIVE, earned, non-mud-slingable address signals + one SEPARATE asset-level
distrust axis (never applied to individuals):
- **Establishment (OG)** = tenure + ln(peers) + ln(dispense_btc) + ln(dividends) + ln(locked).
  Validated: rediscovers curated creators with zero curation.
- **Trust-by-association** = Σ rep(sender)/outdegree(sender) over distinct senders. Validated +
  dust-proof. (PageRank iter-1; extend to multi-hop.)
- Address reputation = blend of the two. Both only ever EARNED, never lost from others' actions →
  safe to show a user their own score; a new/quiet address reads "neutral", never "bad".
- **Asset distrust (separate axis)** = self-trade% OR (few-traders + concentration). Asset-level only.
Key principle proven throughout: every signal is intrinsic (no collections), and reputation flows
only from things you DID or from reputable parties CHOOSING to engage you — nothing an adversary can force.

### Composite validated across diverse addresses
| address | establishment | trust_assoc | read |
|---|---|---|---|
| 1GotRej (OG creator) | 24.1 | 104.1 | high both |
| 1Mafiam (creator) | 19.0 | 12.7 | high establishment |
| 1FCkCQ (early trader) | 10.8 | 1.2 | moderate |
| 1Csz (quiet/swept) | 0.8 | 0.4 | ~0 = NEW/neutral, NOT bad |
Proves the safety goal: additive/earned only → a quiet or new address reads neutral, never negative;
can't be dragged down by others. Axes are usefully independent (assoc captures "reputable parties
engage you" beyond your own footprint). Framework is coherent and sane.

## Archetype classification (SEPARATE algorithm from reputation) — v1, provisional
Precomputed `address_signals` (398k addrs: first_blk, in/out_peers, dispense_btc, dispenses, dividends,
assets_issued, locked_assets, btc_spent). Archetype v1 from thresholds:
passive_recipient 211891 · active_user 169921 · btc_buyer 28380 · minor_issuer 11303 · creator 7613 ·
dispenser_op 5753 · exchange/service 10. Catches big exchanges (EXCH-1/2: huge throughput + ZERO
create/commerce signals) but MISSES small ones (EXCH-3, 300 peers → blends into active_user). Counts
alone can't separate a small custodial service from a heavy trader → needs flow-shape signals
(round-trip ratio, in≈out balance, temporal regularity). Iterate.

## DATA NOTES (discovered, need fixing)
- `dispenses.btc_amount` is TEXT → MAX/MIN/ORDER BY sort lexicographically (broken). SUM coerces OK.
  True max single dispense ≈10 BTC, not 0.1. Cast to INTEGER/REAL wherever sorting numeric TEXT cols.
- `btc_spent` (SUM, correct): captures pure dispenser-buyers INVISIBLE to the send graph (15LeGq:
  2952 BTC, 0 sends). Orthogonal economic-skin-in-game trait, hard to fake (real BTC spent).
- **BTC fees ARE available** (corrected earlier mistake): `transactions.fee` (sats, per tx, has source)
  — already powers the homepage btc_fees metric. Added `btc_fees` to address_signals (SUM by source).
  STRONGEST hard-to-fake economic signal (every CP tx burns real BTC). EXCH-1 = 29.4 BTC lifetime fees,
  EXCH-2 = 9.6 BTC; creators ~0.03-0.08 BTC. Tracks throughput/economic weight (also high for big exchanges).

## EMERGING MODEL — reputation as MULTIPLE dimensions (not one number)
Traits now precomputed per address (398k): tenure, in/out_peers, assets_issued, locked_assets,
dividends, dispenses, dispense_btc(earned), btc_spent, btc_fees. They cluster into dimensions:
1. **Tenure** (first_blk) — age.
2. **Creator footprint** — assets_issued, locked, dividends.
3. **Economic weight** — btc_fees, btc_spent, dispense_btc (real BTC moved; hardest to fake).
4. **Social/trust** — out/in_peers, out-degree-normalized trust-inflow.
+ **Archetype label** (exchange/creator/dispenser/buyer/trader/holder) as a SEPARATE classifier.
Open: how to weight/blend (or keep separate as a radar/profile rather than a scalar). Keep iterating.

## KEY NEGATIVE RESULT — "average holder reputation" is CONFOUNDED (do not use)
Tested aggregate holder quality = avg holder establishment. Result: RESORTLIFE (wash, 4 holders)
scored HIGHEST (8.6) > RAREPEPE (4.61) > PEPECASH (4.35). Because manipulators ARE sophisticated
high-rep addresses, "average holder reputation" rewards wash assets. Same confound as "% veteran
holders". DISCARD avg-holder-reputation as an asset-quality signal — it would rubber-stamp scams.
The honest fairmint/asset-quality read is: **holder COUNT** (RESORTLIFE=4 → red flag) + **distribution/
concentration** + **% creators among holders at scale** (RAREPEPE 14.4% > PEPECASH 9.7% > DIAMONDBOND
0.5% — meaningful for N>~50) + the **asset-level wash axis** (self-trade%). NOT mean holder rep.
Lesson reinforced: a signal that's valid for INDIVIDUALS (reputation) can be actively MISLEADING when
aggregated to judge an ASSET, because adversaries are high-rep. Aggregate on COUNT/DIVERSITY, not MEAN-quality.

## ASSET QUALITY — corrected (un-confounded) model, VALIDATED
Components (NO mean-reputation): holder_count + top1%(concentration) + self_trade%(wash) + %creators@scale.
| asset | holders | top1% | %creators | read |
|---|---|---|---|---|
| RAREPEPE | 208 | 6.1 | 14.4 | healthy (distributed) |
| PEPECASH | 7859 | 30.4 | 9.7 | healthy |
| BITCRYSTALS | 4291 | 59.8 | 5.2 | ok |
| DIAMONDBOND | 210 | 72.5 | 0.5 | unhealthy (concentrated+ring-wash) |
| RESORTLIFE | 4 | 100 | (N=4) | unhealthy (thin+98% wash) |
`top1%` concentration is the standout single signal — orders legit→wash correctly, ungameable by
holding through sophisticated addresses. Mean-reputation got this BACKWARDS. Asset quality = COUNT +
DISTRIBUTION + WASH, never mean-holder-rep.

## SUMMARY OF VALIDATED MODELS (3 distinct algorithms)
1. **Address reputation** (multi-dim: tenure/creator-footprint/economic-weight/social-trust;
   mud-proof, earned-only; dust-proof trust via outdeg-normalized inflow). Ranks real creators at scale.
2. **Archetype classifier** (exchange/creator/dispenser/buyer/user). Works for big actors; small-service
   gap (EXCH-3) needs flow-shape signals.
3. **Asset quality / wash** (count + concentration + self-trade%; NOT mean holder rep).

## PageRank EXPERIMENT — vanilla PR = centrality, NOT reputation (key finding)
Ran real iterative PageRank (5 iters, double-buffered, outdeg-normalized) over the 992k-edge send graph
(pr_edges table + rep_score on address_signals). Converged top = network INFRASTRUCTURE:
sinks (183BUeP: 7790 senders→2 dests = cold storage), exchanges (1Aeqgt, 1XCPdWb), the Counterparty
BURN address, token treasuries (SJCX/FLDC/LTBCOIN). Creators rank LOW: 1GotRej #142, 1Mafiam #2583,
1PH4Kz (516 divs) #51764 (it SENDS dividends, doesn't accumulate inflow).
CONCLUSION: vanilla PageRank measures money-flow centrality — orthogonal to "good actor / OG". It is
a useful NOTABLE-ENTITY / exchange detector (high PR + zero issuance ≈ exchange/treasury/sink), NOT a
reputation signal. For graph-based TRUST, need PERSONALIZED PageRank seeded from known-good nodes so
trust flows from OGs instead of pooling at hubs. Earned-signal establishment model stays the better rep measure.
(Artifacts kept in DB: pr_edges, address_signals.rep_score — reusable for personalized-PR next.)

## Personalized PageRank (seeded from 858 OG creators) — better, still leaks infrastructure
Teleport only to strong-OG seeds (assets_issued>=50 AND locked>=10), propagate along send edges.
Surfaces more real minor-creators (16Kzr7, 173cE6=162 assets, 1NfJnJ=36) + community burns (1BurnPepe),
BUT exchanges still rank top (1Aeqgt #4) because OGs DEPOSIT to exchanges → trust flows there. So
graph-trust (even personalized) MUST be combined with the archetype classifier to subtract
infrastructure (exchange/sink) before it's clean. Conclusion for the whole PageRank family: it's a real
"trusted-by-community" axis but needs archetype filtering; earned-signal establishment stays cleaner standalone.

## NEW SIGNALS validated (Dan's ideas)
- **XCP holding = strong pro-protocol signal.** % holding XCP by tier: big_creator 46.7% · minor_issuer
  21.1% · active_user 3% · passive 2.9%. 16x gradient. Holding/using XCP tracks protocol investment.
- **Asset-type seriousness** (named > numeric > subasset): chain has numeric 122836 ≈ named 115662 >
  subasset 13739. Named cost 0.5 XCP (deliberate) → per-issuer named-asset count/ratio = seriousness signal.
- **Ground-truth anchor**: Dan's own address 19QWX = creator/OG (99 assets, 16 locked, 38 divs, 13.6
  BTC spent, holds 147 XCP); model ranks it appropriately (#20 establishment). Use as validation anchor.
- TODO (Dan's list): Gini coefficient (better than top1% for concentration), bubble-maps (cluster viz),
  "early holder of assets that LATER got trade volume" (good-taste/acumen signal).

## Early-acumen signal (Dan's "early to assets that later got volume") — additive, needs wash filter
acumen(addr) = # of high-trade assets the addr acquired within ~4 weeks of issuance (before volume).
Surfaces a SMART-COLLECTOR cohort independent of creator-footprint: 1DevGw4 (26), 18E6DSB (18, only 1
asset issued = pure collector with taste), several with assets_issued=0. Genuinely additive — captures
good taste the establishment score misses. CAVEAT: "winners"=≥200 trades INCLUDES wash assets
(DIAMONDBOND qualifies) → currently rewards being early to PUMPS too. Fix: define winners by ORGANIC
volume (filter out high self-trade% assets) before crediting acumen. Then it's a clean taste signal.

## Gini coefficient — CONFOUNDED by asset structure (use top1% instead)
Gini across holders: RAREPEPE 0.27, PEPECASH 0.986, BITCRYSTALS 0.992, DIAMONDBOND 0.992. Legit
PEPECASH ≈ wash DIAMONDBOND — Gini doesn't separate quality. Every fungible token is power-law (dust
tail → Gini~0.99); RAREPEPE's low 0.27 is just because it's ~1-per-collector. Gini measures
fungible-vs-collectible STRUCTURE, not health. top1% (dominant holder) is the better concentration signal.

## ===== CONSOLIDATED SIGNAL MAP (after full mining) =====
VALIDATED & USEFUL:
- Establishment (address): tenure + ln(peers/dispense_btc/dividends/locked/btc_fees). Ranks real creators.
- Trust-by-association (address): outdeg-normalized inflow. Dust-proof. (Personalized-PR variant: needs archetype filter.)
- XCP-holding (address): strong pro-protocol gradient (46.7% creators vs 3% users).
- Acumen (address): early-to-organic-winners = smart-collector dimension (independent of creating). Needs wash-filtered winners.
- Asset quality: holder_count + top1% concentration + self-trade% wash. 
- Wash (asset): self-trade% (blatant) + few-traders/concentration (ring). Reproduces+extends blocklist.
- Archetype (address): creator/exchange/dispenser/buyer/user; needed to filter infra from graph-trust.
  EXCHANGE rule REFINED (closes the small-exchange gap): no creation/commerce (assets=div=disp=0) AND
  (out_peers>=1000 OR xcp_balance>=10000). Large XCP CUSTODY is the tell — exchanges hold huge XCP
  (1Aeqgt 265k, 1XCPdWb 132k, EXCH-3 36k). Catches all 3 known exchanges + flags 144 total (was 10).
  Insight: XCP-holding is dual-use — SOME XCP = pro-protocol (good); HUGE XCP + no creation = custodian.
- Asset-type seriousness: named>numeric>subasset.
DISCARDED (confounded / misleading):
- Mean holder reputation (wash assets score highest — manipulators are high-rep).
- % veteran holders (same confound).
- trades_per_trader alone (false-positives liquid blue-chips like PEPECASH).
- Vanilla PageRank as reputation (= centrality: exchanges/treasuries/burn).
- Gini (asset-structure artifact, not health).
PRINCIPLES: intrinsic (no collections) · earned-only (mud/dust-proof) · aggregate on COUNT/DISTRIBUTION
not MEAN-quality · individual-valid signals can mislead when aggregated (adversaries are high-rep).

## Creator SURVIVAL — quality-not-quantity signal (fixes spam-minter weakness) ★
survival% = % of an issuer's assets that reached >=2 holders (escaped the issuer). Cleanly separates
quality from spam: 1GotRej 73.2% (365 issued, 267 alive), 19QWX/Dan 46.3%, 1AwS3wR 27.3% (prolific but
lower), bc1q24kj FACTORY 0.0% (15,598 issued, ONLY 1 ever reached a 2nd holder). Raw assets_issued
ranks the factory as top creator; survival% exposes it as spam. → Weight creator-footprint by SURVIVAL,
not count. New "spam-minter" archetype = high issuance + ~0 survival.

## Archetype labels (v1, provisional): creator(>=5 assets) · minor_issuer(1-4) · exchange/service
(no creation/commerce + high throughput OR >=10k XCP custody) · dispenser_op(>=5) · buyer(btc_spent>0)
· active_user(sends, no issuance) · passive_recipient(only received). Candidate adds: merchant
(reliable dispenser record), hodler/flipper, gambler(bets/rps), collector(broad holdings), spam-minter.

## Archetype DISCOVERY — behavioral palette (distinct participant counts)
DEX orders 20968 (TRADER — biggest, was hidden in active_user) · fairmints 3592 (FAIRMINTER) ·
destructions 2556 (BURNER) · sweeps 1262 (migrator) · bets+rps ~220 (GAMBLER, niche/legacy) ·
pool_matches 1 [WRONG TABLE]. CORRECTION (Dan): LP/AMM is a BRAND-NEW Counterparty feature — activity
is in pool_deposits/pool_withdrawals + pool_lp_balances (in xcpdex DB), not pool_matches. Currently
nascent (2 deposits, 2 pools) but a real EMERGING archetype (Liquidity Provider) that will grow; support it. New archetypes to add: Trader, Fairminter,
Burner, Gambler. STRUCTURAL FIX: archetypes OVERLAP (sampled gamblers also issue 21-43 assets) → model
as MULTI-LABEL TAGS (primary + secondary flags: "Creator · Trader · Burner"), not one exclusive bucket.

## COLLECTOR archetype + asset-breadth dimension — VALIDATED, populous
assets_held (distinct assets currently held) added to address_signals. COLLECTOR = high assets_held +
low assets_issued. 1261 deep collectors (>=100 assets), 7325 (>=20). Examples: 1BXLz1XL (1877 held, 0
issued, 11.5 BTC spent = pure deep collector), 1EUvKmU (1290 + 12.7 BTC = whale collector). Invisible
to creator-score → important distinct archetype for an NFT chain. breadth × btc_spent = high-conviction
collector. Enables a "top collectors" leaderboard. Hodler-vs-flipper (assets_held vs distinct-received)
still untapped.

## Hodler vs Flipper — Hodler clean, Flipper confounded
assets_received (distinct, via sends) added. Hold-ratio = assets_held/assets_received. Among >=20-received:
3287 HODLERS (>=80% kept = conviction, clean signal), 850 low-hold. But low-hold is CONFOUNDED: includes
creators who distributed all issuances (112CLok: rcv 323, held 0, issued 291) + hot wallets — NOT real
flippers. Isolating flippers needs excluding issuers + acquire→sell timing. Hodler usable; flipper TODO.

## ===== CONSOLIDATED ARCHETYPE TAXONOMY (overlapping TAGS, not exclusive buckets) =====
ROLE: Creator (quality=survival%-weighted) · Spam-minter (high issuance + ~0 survival) · Collector /
Whale-collector (breadth × btc_spent; 1261 deep) · Trader (DEX, 20968) · Merchant (dispenser-op) ·
Buyer (btc_spent) · Exchange/Custodian (no-create + throughput OR >=10k XCP) · Fairminter (3592) ·
Burner (2556) · Gambler (~220, legacy) · Liquidity-Provider (emerging, pool deposits).
OVERLAY: Hodler (keeps >=80%) · OG/Veteran (tenure+sustained) · Flipper (confounded-TODO).

## COMMUNITY LANGUAGE & PRIOR ART (from Official Counterparty TG chat, 125k msgs, 2017-2026)
Vocabulary frequency confirms our dimensions ARE the community's mental model. Use THEIR words in UI:
- Quality/desirability: "rare"(1216), "grail"(top-tier collectible), "gem", "series"/"collection", "floor"(price).
- Trust(+): "verified"(592, community verified-dispenser lists), "real"(776), "legit", "clean", "OG"
  (212 = pioneer/foundational, e.g. "Spells of Genesis is the OG... like bitcoin to crypto"), "based".
- Distrust(-): "fake"(676)/"faux", "scam"(519), "spam"(567), "rug"(65, attributed to PEOPLE), "wash",
  "pump/dump/shill". (Use sparingly — Dan: not the police.)
- Behavior: "hodl"/"hold", "collector", "whale", "flip", "fair mint"(=no dev allocation, fair launch;
  NEW + celebrated), "early"(acumen).
PRIOR ART: reputation.coindaddy.io/xcp/asset/{X} + /address/{X} — existing community rating system
(manual ratings, scam flags, feedback). We complement with INTRINSIC on-chain signals.
KEY DESIGN VULN (their words): "scammer can make good reputation address first and then scam big amount"
→ this is why hard-to-fake ECONOMIC (btc_fees/spent) + SURVIVAL signals beat manual ratings / pure graph rep.
DEMAND SIGNAL: "Wen proof of trust" — community explicitly wants this feature.

## FINAL FOUR axes (mined before composing)
- **Longevity-span** STRONG: last_blk added. 64% of addresses = drive-by (<1 day span), 15% sustained
  (>=1yr span), only 2612 recently-active. Sustained presence rare → strong OG/commitment signal. ADD.
- **Reciprocity** MODERATE: mutual 2-way edges (pr_edges self-join). 1GotRej 128, Dan 183, 1Mafiam 10,
  but exchange 1Aeqgt 1290 (round-trips inflate). Genuine-relationship signal but needs archetype context.
- **Asset-durability** STRONG (asset analog of creator-survival): trade-span months. PEPECASH 121mo,
  RAREPEPE 82mo (real=years) vs RESORTLIFE 1.7mo (pump — intense then dead), DIAMONDBOND 13.7mo. Pairs
  with self-trade% for asset quality. ADD (asset-side).
- **Address-format** WEAK: recency proxy (legacy avg blk 580k → segwit 824k → taproot 921k) but legacy
  holds all OGs → not reputation. Soft "modern wallet" hint only. (betweenness/bridging not computed — expensive.)

## ===== COMPOSITION (3-tier hierarchy with inheritance) =====
Tiers: ADDRESS (base) -> ASSET (own metrics + inherits issuer's address rep) -> COLLECTION (aggregate
of members + creator rep + community). Collection = OPTIONAL layer (Dan: core must work without
collection knowledge); collection defined intrinsically (subasset family PARENT.* or shared-issuer),
optionally boosted by curated tags.

### ADDRESS REPUTATION composite v1 — COMPOSED & VALIDATED
rep = 2.0*tenure((955k-first_blk)/100k) + 1.0*span((last-first)/100k) + 1.5*recency(last>=900k)
    + 2.0*ln(1+survived_assets) [survival-weighted creation, spam-proof]
    + 1.0*ln(1+dividends) + 1.0*ln(1+locked) + 1.2*ln(1+btc_fees) + 1.0*ln(1+btc_spent)
    + 0.8*ln(1+dispense_btc) + 0.8*ln(1+assets_held) + 1.0*ln(1+xcp_held) + 1.2*ln(1+rep_score[PPR]).
Validated ground truth: 1GotRej 47.6 (creator) · Dan/19QWX 41.9 · exchanges 40.1/37.0 (labeled EXCH) ·
quiet/swept 1Csz 2.0. Top-10 all recognizable creators, no exchange leakage. ORDERS CORRECTLY.
v2 FIX-LIST: (1) archetype must be MULTI-TAG not single (Dan = creator+collector+OG, got mislabeled
'collector' at survived=19 vs 20 threshold). (2) dispense-only addresses (15LeGq, 2952 BTC) get NULL —
seed first_blk from dispenses+issuances, credit economic signals without sends. (3) assets_issued counts
EVENTS not distinct assets (use survived_assets / COUNT(DISTINCT asset)). (4) normalize rep to 0-100 (percentile).

### ASSET REPUTATION composite v1 — COMPOSED & VALIDATED
asset_rep = 1.5*ln(1+holders) + 0.4*min(trade_span_months,60) [durability]
   - concentration_penalty (top1%>50 -> (top1-50)/10)
   - wash_penalty (self_trade%>30 -> self%/10)
   + 0.5*ln(1+issuer.survived_assets) [INHERITED issuer address-rep].
Validated: PEPECASH 38.7, BITCRYSTALS 36.4, RAREPEPE 33.3 (legit cluster 33-39) vs DIAMONDBOND 11.6,
RESORTLIFE -9.8 (blatant wash goes NEGATIVE). Ordering correct. Own-metrics dominate; issuer inheritance
is a light boost (can weight up so proven-creator tokens start with more earned trust). SPELLSOFGENESIS
returned 0 holders = it's a COLLECTION not a single asset -> validates the separate (optional) collection tier.
### COLLECTION REPUTATION composite v1 — COMPOSED & VALIDATED (intrinsic, OPTIONAL tier)
Intrinsic grouping = subasset family (PARENT.* from asset_longname), no curation needed.
coll_rep = ln(1+members) + 2.0*(survival_pct/100) + ln(1+community_holdings) + 0.5*creator_rep.
Collection health = % members that reached >=2 holders (survival) + community depth (holdings/member).
Validated: PHOCKHEADS/PUNYCODES/OGSAN 100% survival + deep community (1443-1962 holdings) vs BLUEBEAR
76% / HODLTRUMPS 78% (weaker). Separates healthy from weak collections intrinsically. OPTIONAL boost:
curated multi-issuer collections (Rare Pepe etc.) via xcpdex tags = cross-DB join at build time (deferred).

## ===== ALL 3 TIERS COMPOSED + 5/5 EVAL VALIDATED — framework complete =====
Address ✅ (multi-signal, mud/dust-proof) · Asset ✅ (own metrics + inherited issuer rep) · Collection ✅
(intrinsic subasset-family, optional curated layer). Eval: discriminant+convergent+held-out+adversarial+
PREDICTIVE all pass. Remaining: v2 polish (multi-tag archetypes, dispense-only addrs, distinct-asset
counts, 0-100 normalization, asset-rep precompute table), coindaddy held-out, curated-collection cross-DB
layer, then SURFACE in community language (OG/grail/fair-mint/verified). See address/asset/collection composites above.

## ===== EVALUATION / SUCCESS METRICS (how we know the models are good) =====
Reputation has no single label, so validate 5 ways:
1. DISCRIMINANT validity — separates known-good vs known-bad. [DONE qual] asset RAREPEPE/PEPECASH 33-39
   vs wash -9.8; address creators vs drive-bys vs exchanges. Metric: AUC/separation on labeled sets.
2. CONVERGENT validity — independent signals agree. [DONE qual] establishment/trust-inflow/curated all
   rediscover same OGs w/o shared inputs. Metric: rank-correlation of sub-scores.
3. HELD-OUT EXTERNAL labels [✅ DONE vs blocklist] — wash signal (self%>=50, >=30 trades) flagged 8:
   3 already on xcpdex blocklist (PANDAGOLD/RESORTLIFE/TROPTIONS, rediscovered) + 5 NEW high-confidence
   catches (MEAT/MYBLT/NAJBEZ/SOVEREIGNC/TASX, 50-98% self-trade). Signal AGREES + EXTENDS the (incomplete,
   40-entry) manual list = self-updating; complements not replaces. Recall scope-limited (blocklist also
   has dispenser-only/non-wash manual flags DEX-signal can't see -> need separate detectors). coindaddy
   ratings = external API, not fetched (TODO). DISCIPLINE: if a label feeds the model it CAN'T validate it.
4. ADVERSARIAL robustness — [DONE by construction] dust can't raise (outdeg-normalized), junk can't lower
   (no inbound penalty), build-rep-then-rug blunted by hard-to-fake economic/survival. Metric: simulate attack, score unmoved.
5. PREDICTIVE validity [GOLD STANDARD — ✅ DONE, CONFIRMED]: backtest froze creator rep at block 700000
   (~2021), measured post-700k asset survival by pre-700k track record. RESULT: cold-start creators 12%
   survival vs ANY prior track record 24-37% = 2-3x. Reputation PREDICTS future success (not just describes
   past). Robust claim = BINARY has-track-record vs cold-start; fine gradient noisy at small N (31-135
   creators/tier; the raw-COUNT 25+ tier even dips, dragged by spam-factories — reconfirms survival>count).
   This IS the fairmint value prop: "proven creator -> next drop 2-3x likelier to find an audience."
SUCCESS = separates(1) + signals-agree(2) + matches-held-out-labels(3) + ungameable(4) + PREDICTS(5).
Have 1,2,4 (qual). TODO: formalize 3 (precision/recall vs blocklist+coindaddy) and 5 (backtest).
Collection grouping source: xcpdex tags/tag_assets (optional input OR held-out label, not both).

## ===== AXES INVENTORY — MINING ESSENTIALLY COMPLETE =====
DONE & graded: creator-survival[STRONG] · longevity-span[STRONG] · asset-durability[STRONG] ·
asset-breadth/Collector[STRONG] · hodler[clean]/flipper[confounded] · reciprocity[MODERATE, exch-inflated]
· address-format[WEAK, recency proxy] · burn/destruction[WEAK — only issuer-burns-own-supply ~33% is mildly
positive; rest ambiguous] · fairmint-participation[WEAK as rep — it's a NEW-ENTRANT/freshness marker:
3592 minters, only 81 creators/207 collectors, avg first_blk 860k recent; NOT an OG signal].
REMAINING (deferred): betweenness/bridging[expensive graph centrality — likely == PageRank centrality
which we showed = hubs/exchanges, low marginal value]. → mining frontier exhausted; move to composition + eval.

## Next mining / build (not yet done)
- Multi-hop power-iteration PageRank (propagate trust-by-assoc beyond 1 hop).
- Entity-merge sweep-linked addresses before scoring (reputation survives wallet migration).
- De-confound holder `avg_peers` vs same-era assets.
- Make it real: precompute `address_signals` table → fast distributions, aggregate holder quality,
  reputation leaderboard. (Infra, not UI.)

### Still-provisional / to validate before trusting
- OG score weighting (log-scale not yet applied in a measured way).
- "veteran holders %" confirmed CONFOUNDED (wash assets DIAMONDBOND 75% veteran). Do not use.
- Holder-connectivity `avg_peers` looks promising (RAREPEPE 50 vs wash 7–22) but needs a labeled
  holder-quality set to confirm it isn't just "older asset = more connected holders".

## Status
Connections, lineage, and collector-cohort are shipped. Wash score (Signal 1) validated. Next:
prototype Signals 3 & 4 as a precomputed `reputation` score and compare rankings.
