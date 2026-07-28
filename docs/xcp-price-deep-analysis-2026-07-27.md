# XCP price deep-dive — Bitcoin correlation, usage, velocity, and price impact (2026-07-27)

**Question.** What does twelve years of our own price calendar say about how XCP actually behaves —
how tightly it tracks Bitcoin, whether protocol usage moves the price (or the other way around), how
fast the supply turns over, and how much money it takes to move the price?

**Data.** All read-only, from production `xcpio-core` on 2026-07-27:

- `/v2/price` history — 4,590 daily rows (2014-01-02 → 2026-07-27): XCP/USD, BTC/USD, supply,
  attributable volume, source per day.
- `prices` calendar metadata (`source`, `price_kind`, `age_days`) — to separate honestly observed
  days from derived cross-rates.
- `market_price_observations` — 4,733 per-venue rows (dex / dispense / market / burn), including
  the fresh on-chain XCP/BTC edge with its volume and fill count.
- `daily_metrics` — daily Counterparty tx counts, sends, DEX matches, dispenses, issuances, BTC
  fees, XCP burned.

Scripts: extraction + two analysis passes (session scratchpad; method inline below). Every number
here reproduces from those four public/read-only sources.

**Method guard.** 4,542 of 4,590 days are priced from a directly observed aggregate (CMC); only ~46
days are derived on-chain cross-rates (`market_vwm`/thin/burn) where XCP/USD *contains* BTC/USD by
construction. Correlation numbers below use **direct-source day pairs only** unless stated — on a
derived day, "XCP correlates with BTC" would be an artifact of our own arithmetic, not a finding.
(Full-sample numbers barely differ — 0.255 vs 0.262 daily — because derived days are so few, but
the split was checked before trusting anything.)

---

## 1. Bitcoin correlation: real, modest, and regime-dependent

| measure | value |
|---|---|
| daily log-return correlation (direct days, n=4,542) | **0.26** |
| weekly log-return correlation (direct, n=648) | **0.36** |
| weekly beta of XCP on BTC | **0.67** |
| corr(XCP/BTC ratio change, BTC return), weekly | **-0.19** |

XCP is *not* a leveraged BTC proxy. Weekly correlation by year shows two regimes:

- **Coupled years — bear markets and crashes**: 2018 **0.59**, 2022 **0.73**, 2015 0.61, 2014 0.53,
  2017 0.53. When Bitcoin sells off, XCP sells off with it. Correlation is highest exactly when it
  hurts (the classic altcoin property: diversification vanishes in drawdowns).
- **Decoupled years — XCP has its own story**: 2016 **0.05**, 2019 0.06, 2020 0.04, 2023 0.14.
  Those are the years XCP's path was driven by its own events (2016 drift, 2019–2020 irrelevance
  bleed, 2021's NFT/dispenser boom shows only 0.26 because XCP went ×9 while BTC did ×1.6).

The rolling 90-day series confirms it: correlation spikes to 0.6–0.8 in 2018–19 and 2022, and sits
at ≈0.0 (even negative) from late 2023 through 2026 — **currently XCP trades essentially
uncorrelated with Bitcoin**, because its price is set by a handful of on-chain fills, not by macro
flows.

The **-0.19** ratio correlation and **beta 0.67** say the same thing from another angle: when BTC
rallies, XCP participates with only ~⅔ of the move and *loses ground in sats*. XCP-in-BTC is a
long-run decay series punctuated by idiosyncratic spikes (2021: +469% in sats).

**Annual scoreboard (eoy vs eoy, USD):** XCP beat BTC in exactly **2 of 12 full years** — 2016
(+187% vs +126%) and 2021 (+807% vs +59%). Since 2014-01: XCP +152% vs BTC +7,958%; one XCP has
fallen to **3.1%** of its first-print BTC value; the USD price sits **-98%** from the 2018-01-10
ATH of $88.93.

## 2. Usage and price: same era, no lead

- Levels correlate: log daily tx count vs log USD price **0.37** (log mcap 0.38) — busy eras are
  expensive eras. By activity kind (weekly sums vs price): **dispenses 0.59** > trades 0.35 ≈
  sends 0.34 > issuances 0.29. Dispenser activity is the single best usage proxy for price level —
  consistent with dispensers being the venue where price actually transacts since 2021.
- **No lead-lag either way.** Weekly cross-correlation of price returns vs usage growth is ≈0.03
  at every offset from -4 to +4 weeks. Usage growth does not front-run price; price moves do not
  reliably ignite usage the following weeks. Activity and price are joint symptoms of attention
  (an era arrives, both rise), not levers on each other at weekly horizon.
- Counterparty's *share* of Bitcoin transactions correlates with price at only 0.24 — weaker than
  raw counts.
- **Bitcoin fee environment: no relationship.** corr(log BTC fee-per-Counterparty-tx, weekly tx
  count) = 0.09, vs price 0.09. High-fee regimes did not measurably suppress protocol usage at
  this granularity (the composition shifted — OP_RETURN vs bare multisig, batching — but the
  aggregate count did not track fees).

## 3. Velocity: XCP is held, not spent

Attributable velocity = attributable executed volume (on-chain DEX + dispenses + Zaif + Dex-Trade)
÷ supply, annualized:

| year | attributable vol (XCP) | vol (USD) | annualized velocity |
|---|---|---|---|
| 2014 | 31,853 | $101k | 0.012 |
| 2017 | 532,877 | $11.0M | 0.20 |
| 2018 | 1,656,606 | $41.4M | **0.63** |
| 2021 | 1,272,298 | $13.7M | 0.50 |
| 2022 | 589,051 | $3.6M | 0.24 |
| 2024 | 265,243 | $2.0M | 0.10 |
| 2025 | 353,604 | $1.4M | 0.14 |
| 2026 (208d) | 334,373 | $481k | 0.23 |

Even at the 2018 peak, only ~63% of supply turned over in a year through venues we can attribute;
the recent regime is ~10–20%. For comparison, an actively traded asset turns over multiples of its
float annually. **Caveat:** 2015–2020 numbers are floors — Poloniex-era CEX volume is invisible to
us (2015 shows zero attributable volume; the CMC price for those days is real but its volume is
not in our observation store). 2021-onward numbers are close to complete because the attributable
venues WERE the market.

The venue hand-off is visible in fills: DEX matches fade (1,027 in 2014 → ~0 in 2025) while
dispensers carry it (4,510 fills in 2021; ~1,000/yr now) — matching the indexer's design decision
to fold dispenses into the price edge.

## 4. Price impact: what it costs to move XCP

Using day-over-day moves of the fresh on-chain edge (gap of at most 7 days), with day volume in
USD. Restricting to **qualified** edge days (the calendar's own floor: at least 10 fills and 100
XCP) to keep dust prints out:

| regime | median day $vol | median \|move\| | median $ per 1% move |
|---|---|---|---|
| 2021 (n=145) | $23k | 5.2% | **$5k** |
| 2022 (n=306) | $5k | 4.4% | $1k |
| 2023 (n=154) | $3k | 4.6% | $763 |
| 2024 (n=19) | $5k | 10.3% | $583 |
| 2026 (n=13) | $609 | 5.9% | **$79** |

And unfiltered, for the market as it exists **today** (last 365 days): fresh edge on 324/365 days,
median daily volume **$166**, 4.0 fills/day, ~$137k total annual attributable volume, median **$27–79
per 1% of price move**. At the 2021 peak of liquidity it took ~$5k to move the edge 1%; today a
few hundred dollars routinely moves it several percent.

Two structural facts worth internalizing:

- **Volume does not damp moves — it accompanies them.** corr(log $vol, |move|) ≈ 0.05, and the
  *biggest* volume buckets show the *biggest* median moves ($100k+ days: 8.5%). Money arrives on
  the volatile days; there is no standing depth for it to be absorbed by. The largest edge-volume
  day ever — 2021-09-15, $683k — moved the price **-23.6%**.
- **No up/down asymmetry**: up-move days median $6k vs down-move days $5k. Rallies and dumps are
  equally thin.

The "median $ per 1% move" rises mechanically with volume bucket ($197 → $13k), so read it as a
regime descriptor, not an executable order-book depth: it says *on days when $X traded, the price
typically printed Y% away from the last print*, causality unassigned.

## 5. What this adds up to

1. **XCP is a collectible-economy unit, not a beta asset.** Currently ~zero BTC correlation,
   velocity ~0.1–0.2, price set by dispenser fills measured in hundreds of dollars a day. Its
   correlation to BTC only awakens in market-wide crashes.
2. **The price is evidence-thin and the site should keep saying so.** The /price page's provenance
   framing is not pedantry — the honest market-microstructure summary is "324 edge days last year,
   median $166/day". Any UI that charts XCP like a liquid asset (candles included — see the
   TradingView-chart work) should keep fills/volume visible next to price.
3. **Usage is a mirror, not a driver.** Don't build features that imply "activity up → price up
   next week"; the data shows no such lead at weekly horizon. Dispenser activity is the best
   *contemporaneous* proxy of the price era (0.59).
4. **2021 remains the singular anomaly** — the one year XCP overwhelmed BTC (+469% in sats) on
   real, attributable dispenser volume ($13.7M). Every "is it back?" question should be
   benchmarked against that year's shape: $23k median daily volume, $5k per 1% move.

**Methodological note for future work.** Any correlation study on this calendar must class days by
source first: derived days (market_vwm × BTC/USD) share the BTC leg and fabricate correlation.
Here 99% of days are CMC-observed so the distinction barely moved the numbers, but per-era studies
(e.g. pre-2014-06, or any future era where the on-chain edge becomes the primary source) will not
have that luxury.

---

## Addendum 2026-07-28 — the professional toolkit, era split, mania anatomy, float structure

Second pass at the owner's request (framings: CEX vs post-CEX era, three manias, dormant float).
New data: current exchange balances + a HODL-wave query over `balances` × `ledger_events`
(supply bucketed by each holder's last XCP debit, or first credit if never sent). Everything else
recomputed from the same panel.

### Toolkit numbers (daily direct-source returns, n=4,542)

- **Volatility** 176% annualized (BTC same days: 68%); 334% in 2021. Vol clusters (autocorr |r|
  lag-1 = 0.40). Excess kurtosis **24**, skew +1.4, 83 days beyond 3σ (~7× the normal rate).
- **Concentration**: full series compounds to −81.5%; remove the 10 best days → −100%. 43% of
  days are up. Holding XCP = betting on catching a handful of days.
- **Mean reversion**: daily autocorr(1) −0.24. After +15% days: −2.2% median next 7d. After −15%
  days: **+7.2% median / +11% mean next 7d** (n=150). 100 non-overlapping crash-buys averaged
  +6%/trade.
- **Tradability**: naive momentum (+19,464% paper) and buy-the-crash (+33,764% paper) both go to
  ≈ −100% at 5% per-side cost — and measured impact says real size costs more. The inefficiency
  is real and unharvestable at size; the thinness that creates it protects it.
- **Conditional beta** (weekly): 0.85 down / 0.44 up. BTC −10% weeks → XCP −14.8% median; BTC
  +10% weeks → +6.3%.
- **Drawdown**: max −99.4% (2019-05-23); underwater since 2018-01-10 — 3,120 days and counting
  (longest completed: 920 days, 2014→2017).
- **Cycle alignment**: XCP peaked 18mo after the 2016 halving, 16mo after 2020 — then the pattern
  broke: the 2024-cycle peak came 1mo post-halving ($10.02, 2024-05-18) and decayed through the
  echo window. Seasonality: noise (don't publish).

### CEX era (2014–2019) vs post-CEX era (2020–now)

| | CEX era (n=2,142d) | post-CEX (n=2,400d) |
|---|---|---|
| ann. vol | 195% | 157% |
| excess kurtosis | 16 | **38** |
| daily corr w/BTC | 0.32 | 0.18 |
| weekly beta up / down | 0.52 / **1.21** | 0.25 / 0.55 |
| buy-the-crash next-7d median | +5.5% | **+10.3%** |
| attributable volume | $53.1M | $23.1M |
| on-chain edge days (qualified) | 280 (18) | 1,923 (674) |

Delisting cut the BTC linkage roughly in half and halved beta in both directions; day-to-day vol
fell but tails got wilder (kurtosis 16→38: moves are rarer and bigger). Mean-reversion premia
*grew* after the CEXs left — with no market makers, overshoots got larger and paid more to fade.

### Three manias, three different machines

| | M1 Rare Pepe/ICO (2016-09→2018-01) | M2 NFT (2021) | M3 Stamps (2023-03→2024-12) |
|---|---|---|---|
| XCP move | ×26.8 ($3.32→$88.93) | ×24.4 ($1.12→$27.38) | ×4.8 ($2.63→$12.51) |
| BTC same span | ×23.9 | ×1.6 | ×2.8 |
| **sats ratio** | **×1.1** | **×15.2** | ×1.7 |
| usage signature | DEX trades ×6.2 | dispenses ×49, issuances ×37 | issuances ×4, DEX trades **×0.2** |
| 2×-race winner | usage first (Sep-16 vs May-17) | **price first** (Feb-21 vs Jul-21) | usage first (Apr-23 vs Feb-24) |

M1 was Bitcoin's mania wearing an XCP costume (sats ratio barely moved). M2 was the only true XCP
mania — endogenous, dispenser-driven, price led usage. M3 was a usage boom (stamps) that mostly
did NOT accrue to XCP — tx counts soared, the DEX died, price ×4.8 with BTC doing ×2.8. This is
why the full-sample lead-lag is ≈0: each mania had a different causal arrow.

### Float structure (queried live, 2026-07-28)

- Defunct exchanges still hold **423,420 XCP (16.7%)**: Bittrex 254k, Poloniex 141k+, BTER 28k.
  Active venues: Zaif 132k, Dex-Trade 38k. UTXO-held: 9k.
- **HODL waves** (supply by holder's last XCP send): 2014-never-moved **343,834 (13.6%)**;
  last-active ≤2021 = **63% of supply**; the 2019 delisting cohort alone is 409k (16.2%); 2020 is
  291k across just 196 addresses (whale accumulation).
- **Responsive float** (last-active 2024+): **620,843 XCP ≈ $838k** at $1.35. Nominal mcap $3.4M.
- Last-365d attributable volume ($1.1M) = **~0.9× the responsive float** — the slice that moves
  turns over about once a year; the other three-quarters of the ledger is stone.

### Addendum 2026-07-28 (later) — CEX-era impact from CMC reported volume

Correction to the earlier working assumption that CEX-era daily volume was unavailable: the repo
holds `docs/data/cmc-counterparty-historical-listings.ndjson` (3,705 XCP days, 2014-02-15 →
2024-04-28) with `volume_24h_usd` per day. Pairing CMC daily price moves with same-day reported
volume gives the exchange-era impact series (median $/1% of move): 2014 $2k · 2015 $559 · 2016
$6k · **2017 $44k · 2018 $35k · 2019 $718 · 2020 $235** · 2021 $6k · 2022 $20k · 2023 $125 ·
2024 $356. Reported annual volume peaks: 2017 $177M, 2018 $290M.

Cross-validation: **2021 reported ($6k/1%) vs independent on-chain ($5k/1%) agree**; 2023 agrees
within noise ($125 vs $339 on medians of thin samples). **2022 diverges ~20×** ($20k reported vs
$1k on-chain; $73M reported annual volume against a −74% year and $3.6M on-chain) — treated as
inflated exchange self-reporting, excluded from the published table. Full arc for the article:
$44,000 per 1% (2017) → $79 (today), ~500× depth collapse, with the 2019 delistings as the break.

### Addendum 2026-07-28 (later still) — the stamps fee-avoidance counterfactual

Numeric assets (A-prefix, no 0.5 XCP registration fee; subassets excluded — they paid) by
first-issuance year, stamp-tagged split via the `tags` table: 2023 saw 74,068 fee-free numeric
registrations (72,819 stamp-tagged), 2024 saw 32,056 (26,896 stamp-tagged). All-time fee-free
numerics: 130,987 (99,772 stamp-tagged). At 0.5 XCP each, **stamps sidestepped ≈49,858 XCP of
registration demand in 2023–24** while the whole protocol burned 5,649 XCP those years — a
**8.8× avoided-to-actual ratio**, ≈8% of the responsive float. Counterfactual ceiling only:
priced numerics would likely have pushed stamps to another protocol.

Companion number: those same stamp issuance transactions paid **54.63 BTC ≈ $1.85M (same-day USD)
to Bitcoin miners** (2023: 36.68 BTC/$1.03M over 89,105 txs; 2024: 17.94 BTC/$811k over 27,203)
— ~8× what the avoided XCP registrations were worth. Not frugality; routing.

### Addendum 2026-07-28 (evening) — the executable ask side, snapshotted

Live sell-side across all four venues (open dispensers + open on-chain XCP→BTC orders from the
ledger; Zaif and Dex-Trade books via public APIs; JPY via our ECB reference rows, BTC $63,215,
calendar XCP $1.32): **total visible 40,762 XCP (1.6% of supply)** — dispensers 22,792 (cheapest
$1.58), Dex-Trade 11,139, Zaif 6,830, on-chain order book **1 XCP**. Cumulative curve: within
10% of calendar → 28 XCP / **$38**; within 25% → $106; within 1.5× → $4.5k; within 2× →
10,632 XCP / $24.3k; within 10× → $83.4k; the "any price" tail costs $13.7M (dispensers asking
10–100× spot). Zero asks below the calendar price. Independently confirms the supply-crunch
article's ~42k visible-ask estimate and corroborates the $/1% impact regime from the executed
tape. Snapshot is point-in-time (2026-07-28); books shift.

### Addendum 2026-07-28 (night) — cost basis, realized cap, MVRV, overhead supply

Method: per current holder, volume-weighted average USD price over EVERY XCP credit the address
ever received, priced by the daily calendar (caveats: not FIFO of the current balance;
self-transfers re-price basis to transfer day; OTC prices assumed at calendar). Two passes: all
addresses, then excluding exchange custodians (flagged + the known venue list).

- **All holders** (2.52M XCP, 17,101 addresses): realized cap **$18.75M** vs $3.32M market value
  → **MVRV 0.177**. 13.9% of supply in profit at $1.32.
- **Excluding exchanges** (1.90M XCP, 17,091 addresses): realized cap **$12.21M** → **MVRV
  0.205**. In profit: **349,801 XCP (18.4%)** across 2,026 addresses (11.9%). Bands (XCP @ avg
  basis): under-$1 290k @ $0.81 · $1–1.32 60k @ $1.18 · $1.32–2 167k @ $1.65 · $2–5 630k @
  $3.20 · $5–10 387k @ $7.48 · $10–30 344k @ $16.08 · $30+ 23k @ $44.25.
- Delta between passes: **~395k XCP of $10–30-basis supply sits on exchange addresses** — the
  trapped Bittrex/Poloniex coins were deposited around a ~$16 basis (2018–19), presumably to
  sell; the venues died holding them.
- Reference: Bitcoin's aggregate MVRV has never closed a cycle bottom much below ~0.4; XCP at
  0.18–0.21 means the living holder base carries a ~80% aggregate unrealized loss, while the
  only large in-profit cohort (290k XCP @ $0.81 avg) is the sub-$1 accumulation class of
  2019–2020 and the recent lows.

### Addendum 2026-07-28 (late night) — the Rare Pepe Index (RPI v0)

Matched-sample chained median over per-card quarterly median unit prices (collection tag
`rare-pepe`, unified trades stream: DEX + dispensers + Emblem + external; literal self-trades
excluded; links chained only when ≥5 cards traded in both adjacent quarters). 23,147 card-quarter
cells. Base 2016-Q3 = 100:

- 2017 mania peak (2018-Q1): **1,881**. 2018–2020 collapse to **60** — at the 2020 bottom the
  matched sample traded 40% BELOW 2016 launch-era prices.
- 2021 NFT mania: **10,997** at 2021-Q4 (×183 off the 2020 bottom). 2021-Q3 alone did **$69.4M
  volume across 31,864 sales** — more than half of all-time volume in one quarter.
- Today (2026-Q3): **662** — −94% from peak, still 6.6× the 2016 base and 11× the 2020 bottom.
- **All-time attributable Rare Pepe volume: $133.1M over 138,435 sales** — first time this
  number has been computed anywhere.

Fragility notes: the 2020-Q2→2021-Q1 chain rides thin matched samples (3–11 cards; two links
skipped at the ≥5 floor), so the exact level through that transition is soft even though the
direction is volume-corroborated; 2021 volume includes Emblem/external prints where wash can't
be fully excluded (per-card medians resist level distortion, volume totals less so). Natural
v1 upgrades: monthly resolution, grail/common sub-indices, BTC denomination, repeat-sales pairs
instead of quarter medians.

### Addendum 2026-07-29 — the Emblem leak curve

Venue-split quarterly USD volume from the unified trades stream (self-trades excluded).
Venue inventory all-time (raw): dispense $720.8M/179,606 sales, emblem $147.4M/143,309, dex
$53.9M/158,257, otc $7.3M, scarce.city $4.3M, telegram/tokenly minor.
`emblem_vaults.first_seen` is CRAWL date, not vault creation — sales are the emigration proxy.

**Correction (owner challenged the $650M):** the 2023-Q3→2024-Q1 dispenser spike is NOT SRC-20
mint flow as first labeled — it is **three low-quality-flagged tokens**: OXBT $392.4M,
ORDIPEPE $184.8M, OGPASS $67.8M = $645M of the $649M; clean volume in those quarters was
**$3.7M**. The low_quality flag caught 99.4% of it.

**Second correction (owner: "Emblem sales are not all clean"):** right — `low_quality` alone is
not the clean filter. Emblem sales carry `sale_class`: real 43,174/$84.3M · bundle 2,786/$41.1M ·
non_counterparty 14,271/$20.1M · **scam_dump 89,279/$2.8M** · scam_empty 703/$105k. **62% of all
Emblem sale prints are scam dumps moving just ~2% of the money** (avg ~$32). The canonical
admission predicate (the one core-asset-signals uses: dex; dispense=single; otc
likely/corroborated; emblem=real; low_quality excluded) gives the **canonical clean all-time
market: $202.6M over 311,812 sales** — emblem real $83.7M (41%), dispense $70.1M, dex $38.9M,
otc $5.6M, scarce.city $4.3M. Including verified bundles, the Ethereum side is ~51% — "roughly
half" survives, but cite the canonical numbers. The RPI and the Rare-Pepe-scoped leak curve are
UNCHANGED under the strict filter (re-run verified identical): scam prints don't attach to
genuine rare-pepe-tagged assets, so those instruments were already clean; both scripts now carry
the `sale_class IN ('real','bundle')` filter explicitly. Rule stands: any published venue or
market-size number must use the canonical predicate, not raw venue sums.

**Rare Pepe scoped (the clean story):** 100% Bitcoin-side through 2021-Q2; the 2021 mania was
**49% on Ethereum from its first quarter** ($33.9M of $69.4M in Q3); after churn 2022–24, the
emigration completed — **92–96% of Rare Pepe dollar volume settled on Ethereum from 2024-Q4
through 2026-Q1**. All-time: Bitcoin $68.3M vs Ethereum $64.8M (49%). Caveat: 2026-Q2/Q3 show
the emblem venue collapsing to ~$0 across ALL collections — possibly a real market stall
(Sequence-era listing gap) and possibly crawl lag; do not read the tail as "the leak reversed"
without checking the sales crawler cursor.

**Vault census now:** 61,534 vaults · 39,633 funded · only 5,483 ever cracked back to Bitcoin →
**34,150 still locked** (≈86% of funded wraps never came home) · 3,439 scam-flagged. Together:
half the collection's economic life happened on a chain it doesn't live on, >90% recently, and
the wrapped supply is overwhelmingly still out there — the quantified premise of the
"60,000 Bitcoin NFTs are trapped inside Ethereum" article and the pools come-home thesis.

### Addendum 2026-07-29 (later) — the dispenser sniper study: the predator class that never formed

XCP dispenser fills scored against the same day's market VWM (snipe = arm's-length fill at
≤0.5× market on ≥1 XCP; overpay = ≥2×; XCP dispensers only — card dispensers have no daily
reference price). The expected "stale-price sniper economy" **does not exist**:

- **66 qualifying snipes in 12 years, ~$30.8k total captured spread.** The top "sniper" made
  $6.8k on ONE fill (2021-04-12, 110 XCP at 0.07× market) and never repeated; almost every top
  entry is a one-off. No repeat professional class.
- **Overpaying dwarfs sniping 11:1**: 633 fills at ≥2× market, **$355k total overpaid** ($234.5k
  in 2021 alone). During the mania, buyers smashed loaded dispensers regardless of price — the
  dispenser premium was a convenience tax paid *by* buyers, not value leaked *to* predators.
- **Mispostings die same-day**: 49 of 66 snipes hit dispensers opened <24h earlier at 0.01–0.1×
  market — fat-fingered postings grabbed almost immediately, not slow-decay stale prices picked
  off by bots.

Caveats: scored vs the day's VWM, which a large snipe partly sets on thin days (conservative);
deliberate below-market gifts/self-deals across unlinked addresses can't be distinguished from
snipes. Consistent with the impact study's theme: this market has no professionals — not even
the vultures showed up.
