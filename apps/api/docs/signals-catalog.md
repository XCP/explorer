# Signal Catalog — the feature space for asset & address scoring

Treat scoring as ML feature engineering: enumerate every computable signal, hypothesize its polarity,
**measure its discriminative power against a proxy target**, prune redundant ones, then learn weights.
We have no hard labels, so we use **proxy targets**: `vaulted` (people wrap *desirable* assets → ETH
trading) and high liquidity/survival as POSITIVE proxies; `low_quality` (wash/curated/bridge) + `self_trade`
as NEGATIVE. Strength column: ✓✓✓ strong separation (measured), ✓ moderate, ? untested, — none.

Legend: pol = hypothesized polarity (+ good / − bad / ± context-dependent). src = where computed.
status: ✅ computed & in a table · 🔬 measured this lab · 🧩 candidate (computable, not built).

---

## ASSET signals

### Distribution / holders
| signal | def | pol | strength | status |
|---|---|---|---|---|
| holders | distinct address holders w/ balance>0 | + | ✓✓ (2.95x) but WEAKER than demand signals; down-weighted 1.5→1.0. NOTE: earlier "airdrop-gameable" claim was REFUTED — PEPEONMUSK/TESTNETPEPE got holders via paid dispensers (1% from issuer), not free airdrops. The right rationale is just measured strength: durability(20.9x)>>holders. | ✅ |
| top1_pct | % held by top holder | − (concentration) | ✓ | ✅ |
| holder_breadth | avg holdings-depth of its holders | + | ✓✓ | ✅ |
| pct_creator_holders | % of holders who are proven creators | + (peer validation) | ✓ | ✅ |
| holder_gini / HHI | concentration beyond top1 | − | ? | 🧩 |
| burned_pct | % of supply at burn addresses | ± (deflation vs dead) | ? | ✅ |

### Liquidity / trading
| signal | def | pol | strength | status |
|---|---|---|---|---|
| trades | order-match count | + | ✓✓✓ | ✅ |
| **trades_per_holder** | trades ÷ holders (demand depth) | + | **✓✓✓ vaulted 0.26 vs 0.07; airdrops ~0.2 vs bluechips 3-7** → factor added w=1.5 (lab 06-27) | ✅ |
| self_trade_pct | % matches where both sides same addr | − (wash) | ✓✓ | ✅ |
| trade_durability | last−first trade block span | + (endures) | **✓✓✓ 10x lift, ~0 corr w/ volume = strongest INDEPENDENT** → w bumped 1.5→2.0 (lab 06-27) | ✅ |
| time_to_first_trade | blocks from issuance→first trade | − (slow = weak demand) | ? | 🧩 |
| order_count / fill_rate | open orders & matched ratio | + | ? | 🧩 |

### Commerce (dispensers)
| signal | def | pol | strength | status |
|---|---|---|---|---|
| dispense_btc | BTC PAID by buyers via dispensers (a dispenser is a fixed-price vending machine: pay BTC, get BTC÷satoshirate units — a real purchase, NOT a faucet/giveaway) | + (real demand) | ✓✓ | ✅ |
| dispenses | dispense (purchase) count | + (real demand) | ✓ | ✅ |
| dispenses_per_holder | venue mix: vending vs DEX | ± (NOT spray — both are paid; desirable assets skew to DEX trades, primary sales skew to dispensers) | 🔬 vaulted 0.17 vs other 0.29 | 🔬 |
| dispenser_price (satoshirate) | ask price + trajectory | + (rising=demand) | ? | 🧩 |

### Supply / scarcity
| signal | def | pol | strength | status |
|---|---|---|---|---|
| supply (normalized) | issued − destroyed | ± | — | ✅ (assets) |
| supply_scale band | 1/1 · scarce · edition · bluechip · coin | ± (context) | ✓ (earlier) | 🧩 |
| divisible / locked | mutable supply? | locked + | ? | ✅ |
| thin_secondary_market | huge supply + low trades-per-holder (weak DEX liquidity); NOT about dispenser use — dispense sales are real demand | − | ✓ (earlier) | 🧩 |

### Provenance / dynamics (NEW)
| signal | def | pol | strength | status |
|---|---|---|---|---|
| **reissued** | >1 valid issuance | + (managed) | **🔬 14 vs 3 holders** | 🔬 |
| **ownership_changed** | distinct issuers >1 (transferred) | + (changed hands) | **🔬 15 vs 3 holders** | 🔬 |
| supply_changed_over_time | reissuance grew supply | ± (inflation) | ? | 🧩 |
| creator_pct_held | % supply still at issuer | ± (skin-in-game vs dump) | ? | 🧩 |
| asset_age | first issuance block | + (survivorship) | ? | ✅ (assets) |

### Art / tech (description taxonomy — NEW, H11)
| signal | def | pol | strength | status |
|---|---|---|---|---|
| art_storage=onchain (stamp/base64) | data on Bitcoin | + (permanent) | 🔬 105k | 🔬 |
| art_storage=arweave/ipfs | decentralized permanent | + | 🔬 3.6k | 🔬 |
| art_storage=imgur | centralized, link-rot | − (ephemeral) | 🔬 5.8k | 🔬 |
| art_storage=easyasset | tool-made | ± | 🔬 9.5k | 🔬 |
| stamp_protocol | STAMP/SRC-20/SRC-721 | ± (cohort) | ✅ | ✅ |
| mime_type | image/text/html… | ± | ✅ | ✅ |

### Type / cross-protocol
| signal | def | pol | strength | status |
|---|---|---|---|---|
| type (named/sub/numeric) | asset class | named + / numeric − | 🔬 13.5 vs 1.8 holders | ✅ |
| is_vaulted | held in an Emblem vault box | + (desirable) | ✓✓✓ 18× holders | 🔬 |
| vaulted_pct | share of supply vaulted | ± (1/1 vs bluechip) | ✓ (earlier) | 🧩 |
| dividends_paid | dividends on this asset | + (pro-holder) | ? | 🧩 |
| issuer_reputation | creator's address score | + | ? | 🧩 |

---

## ADDRESS signals

### Age / activity
| signal | def | pol | strength | status |
|---|---|---|---|---|
| age (tip−first_blk) | longevity | + but **dominates (67% of top-band)** | 🔬 | ✅ |
| span (last−first) | active lifespan | + | ? | ✅ |
| modern_active | active ≥ block 900k | + (not dead) | ? | ✅ |
| recency (tip−last_blk) | how recently active | + | ? | 🧩 |

### Creation
| signal | def | pol | strength | status |
|---|---|---|---|---|
| survived_assets | issued assets w/ ≥10 holders | + (core creator) | ✓✓ | ✅ |
| assets_hits | issued w/ ≥50 holders | + | ✓ | ✅ |
| assets_distributed | issued w/ ≥2 holders | + | ✓ | ✅ |
| assets_issued | total issued | ± (flood risk; NOT rewarded) | 🔬 flooders don't game | ✅ |
| **creator_success_rate** | survived ÷ issued | + (quality not quantity) | ? | 🧩 |
| locked_assets | locked-supply issuances | + (no rug) | ? | ✅ |

### Holding
| signal | def | pol | strength | status |
|---|---|---|---|---|
| assets_held | distinct assets held | + | ✓ | ✅ |
| assets_received | distinct assets ever received | + | ? | ✅ |
| collector_breadth | variety/diversity of holdings | + | ? | 🧩 |
| holding_duration | diamond-hands vs flipper | + | ? | 🧩 |

### Economic
| signal | def | pol | strength | status |
|---|---|---|---|---|
| btc_fees | lifetime miner fees | + (skin-in-game) | ✓ | ✅ |
| btc_spent / clean_btc_spent | BTC spent collecting | + | ✓ | ✅ |
| dispense_btc / clean | BTC earned dispensing | + (merchant) | ✓ | ✅ |
| xcp | XCP held | + (stake) | ✓ | ✅ |
| dividends | dividends paid | + | ✓ | ✅ |
| assets_burned | clean assets sent to burn | + (pro-protocol) | ✓ | ✅ |

### Trading / behavior
| signal | def | pol | strength | status |
|---|---|---|---|---|
| dex_trades | order-match participation | + (active) | 🔬 added | ✅ |
| order_fill_rate | matched ÷ opened orders | + (serious) | ? | 🧩 |
| send_count | total sends (vs out_peers=distinct) | ± | ? | 🧩 |
| out_peers / in_peers | distinct counterparties | ± (in_peers huge=service) | ✓ | ✅ |
| reciprocity | in∩out peers (mutual) | + (real relationships) | ? | 🧩 |
| disp_trust | longevity-weighted dispenser record | + | ✓✓ | ✅ |

### Classification flags (gates, not scores)
| signal | def | use |
|---|---|---|
| is_exchange / is_deposit | infra | exclude from user rep |
| is_burn | burn addr | exclude |
| is_emblem_vault | custody box (not a person) | exclude |
| likely_service | high in-degree heuristic | exclude/flag |
| is_btns_user | BTNS broadcaster | cohort tag |
| broadcaster_type | oracle-feed vs message vs BTNS | 🧩 cohort |

### Cross-protocol cohorts
| signal | def | pol | status |
|---|---|---|---|
| stamps_created | issued stamp assets | + cohort | ✅ |
| stamps_collected | distinct stamps held | + (engaged) | ✅ |
| src20_deploys | SRC-20 token deploys | + | ✅ |

---

## Sweep results — 2026-06-27 (the ranked, bucketed findings)

**ASSET signals vs the `vaulted` proxy** (collectible-desirability; lift = ×higher in vaulted pop., corr = vs the popularity confound). Strength ranked:
| signal | bucket | lift | independent? | verdict |
|---|---|---|---|---|
| trade_durability | demand | **20.9** | ✓✓✓ (corr .07) | **top signal** — traded over years |
| trades | demand | 8.69 | ✗ (corr .39 w/ holders) | strong but popularity-confounded |
| burned_pct | scarcity | **6.68** | ✓✓✓ (corr .05) | **new keeper** — independent scarcity |
| trades_per_holder | demand | 3.8 | ✓✓ (corr .24) | keeper — demand depth, airdrop-proof |
| holders | distribution | 2.95 | ✗ (corr .39) | gameable (airdrops) → down-weighted |
| dispenses | commerce | 1.56 | ✗ (corr .62 w/ holders) | ~duplicate of holders |
| locked | scarcity | 1.11 | ✓ | weak + |
| holder_breadth | community | 0.88 | — | different axis (community, not collectible) |
| top1_pct | distribution | 0.78 | — | mild − (concentration) |
| pct_creator_holders | community | 0.70 | — | different axis |
| self_trade_pct | anti-quality | 0.60 | ✓ (corr .005) | clean independent − (wash) |
| dispenses_per_holder | commerce | 0.58 | — | venue mix, not quality |
| divisible | structural | 0.31 | — | indivisible = collectible marker |
| dispense_btc | commerce | 0.20 | — | vaulted trade on DEX not dispensers |

**ADDRESS signals — correlation grouping** (no clean external label, so we map structure not strength; infra excluded):
- **Buckets are GENUINELY INDEPENDENT** — every cross-bucket corr ≈ 0 (create~econ .08, hold~econ .01, social~econ .05, age~create .00). The model isn't double-counting; each bucket adds orthogonal info.
- **AGE**: age & span weakly related (−.24) — keep both.
- **CREATION**: `survived_assets` is primary; `assets_hits` is an elite subset (corr .63); `assets_issued` corr only **.08** with success → flooding ≠ quality (correctly 0-weighted); `locked_assets` independent (.09).
- **HOLDING**: `assets_held` primary; `assets_received` is a **duplicate** (corr **.775**) — excluded from factors. ✓
- **ECONOMIC is NOT a tight cluster** — `btc_fees`, `btc_spent`, `dispense_btc`, `dividends` are mutually ~0 correlated = four independent economic behaviors, each its own info. (xcp not in the signal table — read at score time.)
- **SOCIAL/BEHAVIOR**: `out_peers`, `in_peers`, `dex_trades` all weakly correlated (.11–.15) = independent dimensions.

**Multi-axis caveat:** `vaulted` is a *collectible-desirability* proxy. It validates the demand+scarcity axis but is INVERSE to the community/distribution axis (broad tokens like LTBCOIN). Asset quality is multi-axis — we keep community + commerce signals on theory even though they don't predict vaulting. Don't overfit to one proxy.

## v1 dialing + validation — 2026-06-28

**Anchors recalibrated** to the observed raw distribution (full factor set): p50=2.0, p90=7.1, p99=26, max=60.6
→ `ASSET_PCT={floor:0.5,p50:2.0,p90:7.1,p99:26,max:60}`. (Was p99:16/max:40 → saturated.)

**Social validation (Telegram, independent human label):** Spearman(raw_score, mentions)=**0.296** across 19,182
assets (positive convergent validity); vaulted assets get **4.6× more mentions**. Score and mentions are
correlated but DISTINCT axes — score = on-chain market quality, mentions = community buzz (biased by which
chats: BITCORN echo chamber inflates CORN assets). Cross-community grails (PEPECASH, RAREPEPE) rank high on
both. Conclusion: social attention is best as its OWN future signal, not a reshaper of the quality score.

**Address signals (vs a constructed "holds a desirable/vaulted asset" proxy):** survived_assets 24.0x (indep),
dex_trades 12.4x, btc_fees 3.8x, out_peers 2.5x — addresses DO have strong, measurable signals; current
ADDRESS_FACTORS weights align with strength. (assets_held 13x is tautological with the proxy → discounted.)

## Weighting / ML notes
- **Targets/proxies:** POSITIVE = vaulted, high trades_per_holder, survived, durability. NEGATIVE = low_quality, self_trade, thin_secondary_market, imgur-storage.
- **Multicollinearity to watch:** holders↔trades↔trade_durability (all "popularity"); btc_spent↔dispense_btc↔xcp ("wealth"); age↔span. Use one representative or PCA-style grouping so we don't triple-count one latent factor.
- **Measured strongest separators so far:** trades_per_holder, is_vaulted, trade_durability, holders, ownership_changed/reissued, survived_assets.
- **Known weak/risky:** raw holders (a creator CAN seed holders by self-buying their own dispenser, but it costs real BTC each time, so not cheap gaming — still prefer trades_per_holder), age (dominant but admits few freeloaders → false-negatives for new cohorts), assets_issued (flood-proof: 0 weight is correct).
- **Dispensers are paid vending, not faucets:** dispense_btc/dispenses = real demand (positive), in the same "economic demand" family as DEX trades. Total demand ≈ trades + dispenses; the grail "liquidity depth" lens is specifically SECONDARY (trades_per_holder), distinct from primary dispenser sales — both are real money.
- **Next:** compute the 🧩 candidates (trades_per_holder & dynamics already 🔬), assign polarity, then fit weights against the proxy targets and validate on the labeled spot-check list.
