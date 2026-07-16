# Reputation, ratings, tags, and graph audit

Date: 2026-07-16

## Executive assessment

The system is useful, unusually transparent for a heuristic ranking system, and built on a strong data foundation. It already has several good properties: exact signal provenance in code, log transforms for heavy-tailed activity, explicit infrastructure states, separate market quality and holder conviction views, coarse display tiers, deterministic graph construction, and a synthetic Sybil test.

It is not yet defensible as an objective measurement of “quality” or “trust.” It is a collection of well-motivated heuristics with limited validation. The main problems are correlated factors being counted more than once, circularity between score-derived seeds and graph-derived conviction, curated labels mixed into inferred scores, stale calibration tooling, and validation cohorts that share causes with the features being validated.

The right end state is not a more complicated formula. It is a more legible measurement system:

1. facts and classifications with provenance;
2. a small number of named, independently interpretable score axes;
3. a clearly described composite rank, if one is still useful;
4. reproducible evaluation reports showing stability, separation, and attack cost;
5. uncertainty or “insufficient evidence” states where the chain cannot support a conclusion.

## What exists today

### Address reputation

The address score combines longevity, activity span, successful creation, dividends, locked assets, BTC fees, BTC spent, dispense proceeds, collection breadth, XCP holdings, DEX activity, Stamp creation, and three explicit Emblem-scam penalties. Infrastructure, deposits, vaults, burns, services, and dormant addresses are separated from ranked users.

This is best interpreted as **Counterparty participation and track record**, not moral reputation. Most positive factors measure investment, tenure, or activity. They do not establish honesty. The explicit scam signals are closer to safety judgments, but currently affect only one address in the live population.

### Asset rating

The asset score combines realized value, commerce breadth, market activity and durability, scarcity, age/recency, holder count, and holder quality. A curated `low_quality` classification hard-caps the displayed tier.

This is best interpreted as **market evidence and durability**, not intrinsic quality. That is a valuable product. The current “quality” name encourages users to read more into it than the inputs prove.

### Conviction

Conviction intentionally excludes direct market-value inputs and combines holder sophistication, creator ownership, scarcity, holder breadth, graph proximity, distribution, and concentration.

This is a useful second axis, but it is not fully orthogonal to the market score: holder variables are correlated with market activity, and graph seeds include assets selected by the market score and addresses selected by reputation-derived tags.

### Tags

Tags currently do several jobs: curated collection membership, derived behavioral archetypes, infrastructure/safety classification, protocol/media attributes, and discovery labels. They are operationally convenient but semantically different. Every tag should expose at least `source`, `method` (`curated`, `derived`, or `external`), and `updated_at`; derived tags should also expose their rule/version. Confidence should only be present where there is a real probabilistic or evidentiary interpretation.

### Graph

The graph runs three seeded personalized PageRank vectors and takes their minimum for conservative trust, plus a reverse-graph distrust vector. It includes transaction relationships, order matches, dispenses, issuance, and optionally holdings. Known infrastructure is prevented from emitting trust.

This is a thoughtful implementation of **seed proximity**. The output should be described that way. A send is not necessarily an endorsement; a trade is explicitly adversarial commerce; a holding can be an unsolicited airdrop. Edge semantics therefore do not justify the stronger word “trust” without qualification.

## Live measurements

Measured against production D1 on 2026-07-16:

- 253,636 asset signal rows; 22,873 have a market (`trades > 0 OR dispenses > 0`).
- 155,548 assets have holders; 20,249 have realized USD; 7,462 have DEX traders; 19,443 have non-self dispense buyers.
- 79 assets are curated low-quality.
- 441,331 address signal rows; 356,219 are in the current ranked population returned by the review endpoint.
- 2,233 addresses have survived assets, 16,875 have DEX trades, 262,858 hold assets, and 168,543 have positive BTC fees.
- Only one address currently has any of the three explicit scam signals.
- Positive graph mass reaches 115,230 assets for trust and 99,948 for distrust; it reaches 271,857 addresses for trust and 96,526 for distrust.
- With current graph cuts, 11,193 assets and 19,528 addresses are trusted; 1,718 assets and 1,425 addresses are distrusted.
- The graph catches 76 of 79 curated low-quality assets. Twelve clean, active assets (`holders > 100`, `trades > 10`) are also in the distrusted tier. The latter requires manual review; it is not automatically a false positive.

Pearson correlations after applying the same family of log transforms used by the score, over market assets:

| Pair                                  | Correlation |
| ------------------------------------- | ----------: |
| trades / distinct traders             |       0.982 |
| holder breadth / average holder DEX   |       0.890 |
| holders / holder breadth              |       0.686 |
| dispense buyers / dispenser operators |       0.578 |
| realized value / trades               |       0.276 |
| realized value / distinct traders     |       0.264 |

Graph trust correlates about 0.51–0.54 with holder breadth, holder DEX activity, holder count, and trades. It adds information, but is not independent of the popularity/community family.

The vaulted validation cohort currently has median raw 41.46 versus 14.864 for non-vaulted market assets (gap 26.6). This is convergent validity, not an unbiased label: wrapping is itself driven by perceived value, age, community, and collectibility.

## Correctness issue found and fixed

`GET /v2/reputation/asset-review` claimed to report top-1% and top-10% counts, but used obsolete hard-coded raw cutoffs (`16` and `9`) over all 253,636 assets. The current score is calibrated over the 22,873 market assets and uses different tier thresholds.

The endpoint now uses the market population and reports counts for the actual configured tiers (`bluechip`, `premium`, `notable`, and `speculative`). Its contract test asserts that the buckets partition the population. This makes the calibration surface agree with the product score.

## Research basis and limits

- PageRank defines a stationary distribution over a directed link graph with teleportation. Its ranking meaning comes from the semantics of links and the teleport vector; it does not infer trust by itself. See Page and Brin, [The PageRank Citation Ranking](https://ilpubs.stanford.edu:8090/422/1/1999-66.pdf).
- TrustRank propagates from a small expert-selected good seed set and explicitly depends on seed quality and graph assumptions. See Gyöngyi, Garcia-Molina, and Pedersen, [Combating Web Spam with TrustRank](https://www.vldb.org/conf/2004/RS15P3.PDF).
- EigenTrust uses normalized local experience and pre-trusted peers, and evaluates threats such as collusion and inauthentic identities. Its key lesson here is to state the local evidence and adversary model, not merely use an eigenvector. See Kamvar, Schlosser, and Garcia-Molina, [The EigenTrust Algorithm for Reputation Management in P2P Networks](https://dl.acm.org/doi/10.1145/775152.775242).
- Sybil defenses based on social graphs rely on limited attack edges and fast mixing inside an honest region. A transaction graph does not automatically satisfy those assumptions. See Cao et al., [Aiding the Detection of Fake Accounts in Large Scale Social Online Services](https://www.usenix.org/conference/nsdi12/technical-sessions/presentation/cao).

The current Min-k construction is a sensible defense against an attacker close to only one seed subset. The synthetic test proves that narrow claim. It does not prove resistance when an attacker can establish edges near all three deterministic subsets, when seed selection is contaminated, or when unsolicited transfers create edges.

## Candidate-method landscape

The table below distinguishes a method being academically established from it being appropriate for our observations. “Fit” means fit for this product and data, not general merit.

| Method family                                     | What it would do                                                                  | Fit                           | Decision                                                                                                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Robust weighted composite                         | Combine named evidence using logs, caps, decay, and family budgets                | High                          | Keep, simplify, and validate. Best match for an open, explainable system.                                                                                                                |
| Multi-criteria decision analysis (AHP/TOPSIS)     | Formalize weights or distance from an ideal asset                                 | Low–medium                    | AHP formalizes subjective pairwise preferences but does not make them objective; TOPSIS introduces ideal-point and rank-reversal choices. Little gain over a transparent weighted model. |
| PCA / exploratory factor analysis                 | Find common latent dimensions and reduce correlated inputs                        | Medium as a diagnostic        | Use to discover redundancy and factor families, not as the public score. Maximum variance is not maximum quality, signs can flip, and components drift as the population changes.        |
| Item-response / latent-trait models               | Infer an unobserved quality trait from multiple indicators                        | Low now                       | Requires a defensible measurement model and conditional-independence assumptions our market and holder signals violate. Revisit only with stronger labels.                               |
| Pairwise/listwise learning-to-rank                | Learn weights/nonlinear interactions from ordered examples                        | Medium later                  | Valuable only with independent labels and temporal holdouts. Curated grails versus junk are too small and preference-laden for the sole training target.                                 |
| Gradient-boosted trees                            | Predict future outcomes from nonlinear feature interactions                       | Medium for research           | Strong benchmark for forward prediction, poor primary public score because explanations and monotonicity are harder. Use as a challenger model, not source of truth.                     |
| Bayesian Beta/Dirichlet reputation                | Update belief from repeated positive/negative interactions                        | Low for current address score | We lack explicit transaction satisfaction outcomes. Applying it to sends/trades would invent feedback that is not observed.                                                              |
| Empirical-Bayes shrinkage                         | Pull sparse rates/means toward a population prior                                 | High                          | Useful for evidence strength, buyer breadth, incident rates, and thin-market estimates. Prevents one observation from looking certain.                                                   |
| Wilson lower bound                                | Conservatively rank positive/negative review ratios                               | Low now                       | Excellent for binary ratings, but we have no honest on-chain thumbs-up/down variable. Could apply to a future explicit review system.                                                    |
| PageRank / personalized PageRank                  | Measure stationary graph centrality or proximity to seeds                         | High for proximity            | Current foundation is reasonable when named accurately and evaluated by edge/seed ablations.                                                                                             |
| HITS                                              | Mutually reinforce hub and authority roles                                        | Low                           | Hub/authority semantics do not map cleanly to holders, issuers, and assets; vulnerable to tightly knit reinforcement.                                                                    |
| EigenTrust                                        | Aggregate normalized local transaction satisfaction with pre-trusted peers        | Low                           | Its key input—local satisfaction—is absent. Our transaction occurrence graph is not an EigenTrust evidence graph.                                                                        |
| TrustRank / Anti-TrustRank                        | Propagate from selected good/bad seeds                                            | Medium–high                   | Closest research analogue to the current graph. Seed bias and graph semantics must remain explicit. Best used for discovery/triage, not fact.                                            |
| SybilRank / social-graph Sybil defenses           | Rank nodes by limited connectivity to an honest region                            | Low–medium                    | Useful attack-model inspiration. The required fast-mixing honest region/few attack-edge assumptions are unproven for commerce and transfer graphs.                                       |
| Community detection (Louvain/Leiden, conductance) | Find dense holder/trader communities and boundary structure                       | Medium                        | Useful for diagnostics, collection discovery, and coordinated-ring detection. Community membership is not quality by itself.                                                             |
| Graph embeddings / GNNs                           | Learn nonlinear node representations from topology and features                   | Low now                       | Label-hungry, harder to explain, easier to leak future information, and difficult to justify in an open public rating. Keep as offline research only.                                    |
| Motif / subgraph anomaly detection                | Detect cycles, self-dealing, fan-out airdrops, rings, and repeated counterparties | High for safety               | Strong complement to positive scoring. Produces concrete evidence and should feed a separate risk layer rather than subtracting vaguely from quality.                                    |
| Wash-trading / market microstructure measures     | Detect self-trades, circular flow, concentration, illiquidity, and price impact   | High                          | Add independent market-integrity axes. Adapt carefully because Counterparty markets are sparse and multi-venue.                                                                          |
| Survival analysis                                 | Estimate continued activity/survival while handling censoring                     | High for validation           | Better than hand-chosen age bonuses for testing whether signals predict persistence. Can remain offline evaluation initially.                                                            |
| Exponential/hyperbolic time decay                 | Reduce standing when evidence becomes stale                                       | High                          | Already used. Compare half-lives by forward validation instead of choosing them solely by face validity.                                                                                 |
| Hawkes/process-intensity models                   | Model clustered event arrivals and endogenous activity                            | Low–medium                    | Potentially useful for detecting bursts/pumps, but too complex for the core rating until simpler burst features are tested.                                                              |
| Quantile/rank normalization                       | Make heavy-tailed factors comparable without Gaussian assumptions                 | High                          | Current log transforms plus percentile display are directionally right. Calibration must be versioned and tied to the correct population.                                                |
| Isotonic/Platt calibration                        | Convert model output to empirical event probability                               | Medium later                  | Only meaningful after choosing a future binary outcome. Do not call a percentile score “90% quality.”                                                                                    |
| Conformal prediction                              | Provide finite-sample uncertainty under exchangeability                           | Low–medium later              | Potentially useful around a supervised outcome, but temporal/adversarial drift violates naive exchangeability. Not a fix for an undefined target.                                        |
| Sensitivity/ablation analysis                     | Measure dependence on factors, families, seeds, and thresholds                    | Very high                     | Immediate priority. It directly tests whether conclusions survive reasonable modeling choices.                                                                                           |
| Goodhart/mechanism-design analysis                | Evaluate how public rules change participant behavior                             | Very high                     | Mandatory because weights are open and economic actors can optimize them. Report cost-to-manipulate, not merely correlation.                                                             |

### Additional primary references

- RankNet is a canonical pairwise learning-to-rank method: Burges et al., [Learning to Rank using Gradient Descent](https://dl.acm.org/doi/10.1145/1102351.1102363). Its applicability depends on credible pairwise labels.
- Fisher's discriminant work is an early foundation for supervised dimensional reduction; PCA/factor extraction should not be confused with a value judgment: Fisher, [The Use of Multiple Measurements in Taxonomic Problems](https://doi.org/10.1111/j.1469-1809.1936.tb02137.x).
- Bayesian reputation models are designed around explicit binary feedback: Jøsang and Ismail, [The Beta Reputation System](<https://doi.org/10.1016/S0167-4048(02)00271-9>). Transaction occurrence is not equivalent to positive feedback.
- Wilson intervals address uncertainty in binomial proportions and motivate conservative ranking under small samples: Wilson, [Probable Inference, the Law of Succession, and Statistical Inference](https://doi.org/10.1080/01621459.1927.10502953).
- A standard illiquidity measure relates absolute return to dollar volume; it illustrates the market-microstructure approach but would need sparse-market adaptation here: Amihud, [Illiquidity and Stock Returns](<https://doi.org/10.1016/S0304-405X(01)00024-6>).
- The practical Goodhart warning is that a measure used as a target changes the system being measured. For an open economic score, adversarial cost and manipulation tests are part of validation, not optional commentary.

### Methods worth prototyping first

1. **Family-budgeted robust score:** retain the public, interpretable formula but cap each evidence family so correlated columns corroborate rather than multiply one another.
2. **Empirical-Bayes evidence strength:** accompany each axis with a shrinkage-based confidence/evidence indicator driven by independent counterparties, venues, and time span.
3. **Time-split challenger model:** use monotonic gradient-boosted trees or a pairwise ranker offline to test whether nonlinear interactions materially predict future demand/survival better than the transparent score.
4. **Graph ablation suite:** preserve seeded PPR, but quantify seed dependence, edge dependence, partition dependence, and multi-subset attacks.
5. **Separate integrity model:** build concrete self-dealing, ring, airdrop, concentration, and burst features. Surface evidence; do not bury safety inside a market-quality scalar.

Methods explicitly not recommended for production now: a GNN, a generic PCA score, EigenTrust without satisfaction feedback, SybilRank claims without verifying its graph assumptions, or a supervised ranker trained only on the current curated collections.

## Prioritized recommendations

### P0 — make claims match evidence

1. Rename public descriptions:
   - address reputation → “track record” or explicitly explain that reputation means protocol participation;
   - asset quality → “market rating” or “market evidence”;
   - graph trust → “network standing” or “seed proximity,” while retaining trusted/distrusted only as clearly defined product labels.
2. Keep `low_quality` and fraud classifications visibly separate from numeric scores. A curated safety judgment should not masquerade as a statistically learned contribution.
3. Publish score population, factor definitions, transforms, weights, anchor date, and evaluation snapshot beside every methodology page.

### P0 — remove accidental double counting

Group factors into latent families and budget weight per family rather than per raw column:

- realized value;
- demand breadth/activity;
- longevity/recency;
- scarcity/concentration;
- holder/community standing;
- explicit safety classifications.

Within a family, select one primary feature and at most one corroborator. The immediate candidates are:

- remove or sharply reduce either `trades` or `distinct_traders` (r = 0.982);
- combine or reduce `holder_breadth` and `avg_holder_dex` (r = 0.890);
- do not count graph trust at full weight alongside all three holder-community measures without ablation evidence.

### P1 — build a reproducible evaluation report

Check in a script that emits a versioned JSON/Markdown report with:

- population coverage and missingness for every factor;
- p50/p90/p99/max and tier sizes;
- transformed feature correlation matrix;
- rank sensitivity when each factor and each family is removed;
- rank drift versus the previous release (Spearman correlation and tier migrations);
- curated-good/curated-bad recall, contamination, and named exceptions;
- graph seed counts, tier counts, and seed-ablation results;
- score concentration by issuer, collection, venue, and era.

This report should be generated before weights change. Configuration comments are not a durable experiment log.

### P1 — validate forward in time

Freeze features at historical cutoff dates and test outcomes after the cutoff. Candidate outcomes:

- future distinct buyers and future realized value for the market rating;
- future survival/activity for address track record;
- future broad ownership excluding issuer-controlled and dust balances for conviction;
- future curated safety incidents for distrust, while acknowledging the very small label set.

Use multiple rolling cutoffs. Do not tune and evaluate on the same twelve hand-selected assets. Report performance separately by era and market venue.

### P1 — graph ablations and adversarial tests

Run and compare:

1. curated-only seeds versus algorithmic score-derived seeds;
2. no holding edges versus holding edges;
3. no raw-send edges versus sends that meet a value/repetition/reciprocity condition;
4. current flat edge weights versus recency decay;
5. random alternative 3-way seed partitions;
6. attacks connected to one, two, and all three seed subsets;
7. unsolicited dust/airdrop attacks against assets and addresses.

The current deterministic FNV partition is reproducible but observable. It should not be described as security against a strategic adversary who can choose counterparties.

### P1 — distinguish score from percentile

The displayed 0–100 value is a piecewise percentile mapping, not a probability or cardinal measurement. Document it as a rank score. Recompute anchors from the canonical target population and store a dated calibration snapshot. Add a drift alert when observed quantiles or tier shares move materially.

### P2 — improve uncertainty and cold start

- Keep `Untraded`, `Dormant`, and graph `unscored`; these are honest states.
- Add an evidence-strength indicator based on independent counterparties, venues, and observation span.
- Avoid a single huge sale or one community cluster producing high certainty even if it produces a high point estimate.
- Consider showing axis values and evidence strength before showing a composite number.

### P2 — normalize tag semantics

Define tag namespaces or kinds:

- `collection:*` — curated or externally sourced membership;
- `protocol:*` / `media:*` — deterministic facts;
- `behavior:*` — threshold-derived archetypes;
- `infra:*` — exchange, deposit, vault, burn, service;
- `safety:*` — curated or derived risk classifications.

The UI can keep friendly labels. The storage/API should expose provenance and rule version so open-source contributors can understand ownership and avoid collisions.

## Recommended immediate sequence

1. Land the calibration endpoint correction.
2. Add the reproducible evaluation script without changing weights.
3. Generate a baseline report and manually review graph contamination and top/bottom rank exceptions.
4. Run factor-family and graph-seed ablations.
5. Make the smallest weight reductions supported by those results.
6. Only then recalibrate anchors and update public methodology language.

This sequence preserves the useful system while replacing intuition-driven retuning with evidence that another contributor can reproduce.

## Definition of success

There is no single observable variable called reputation or quality. Success therefore means improving a defined user decision using information that existed at the decision date. Every evaluation must use historical feature snapshots and later outcomes; otherwise it leaks the answer into the predictors.

### Address track record

**User decision:** “How much established Counterparty history and evidence of continued participation does this address have?” It must not claim that an address controls one human or is morally trustworthy.

Primary future outcomes, measured 90, 180, and 365 days after a cutoff:

- active again in the future window;
- number of future independent counterparties, excluding self, infrastructure, and known deposit forwarding;
- number of future substantive protocol actions, with dust and unsolicited receipts excluded;
- continued creator/merchant/trader behavior relevant to the displayed persona;
- documented adverse events, reported separately because the base rate is currently too small to train a general fraud model.

Baselines to beat:

- last activity only;
- lifetime transaction count only;
- address age only;
- a simple recency-frequency model.

Success metrics:

- precision/recall and area under the precision-recall curve for future return (prefer PR-AUC to ROC-AUC when return is imbalanced);
- top-decile lift: future return and independent-counterparty rates among the highest-ranked addresses versus the eligible population;
- rank correlation with future substantive activity;
- calibration by evidence band, if the product ever displays a probability;
- tier stability when no new evidence arrives, alongside justified movement when meaningful evidence does arrive;
- cohort results by first-active era and persona so old creators do not define success for new merchants.

The graph earns a place in address standing only if adding it improves held-out results over the non-graph baseline and passes attack tests. “It produces plausible famous addresses” is not sufficient.

### Asset market rating

**User decision:** “How much durable, independently corroborated market evidence does this asset have?” This deliberately avoids claiming artistic merit.

Primary future outcomes, measured 90, 180, and 365 days after a cutoff:

- at least one future arm's-length sale;
- future distinct buyers and traders;
- future realized value, using robust log/median targets rather than raw whale-dominated sums;
- active across more than one future month and, where possible, more than one venue;
- holder retention and non-issuer distribution, excluding dust/airdrop balances;
- drawdown/manipulation flags reported as integrity outcomes, not silently treated as low artistic quality.

Baselines to beat:

- past maximum sale only;
- past total volume only;
- holders only;
- recency plus frequency;
- current transparent score without graph/holder-quality features.

Success metrics:

- NDCG or Spearman correlation for future independent demand/value ranking;
- precision and lift in the top rating tier for future market persistence;
- Brier/log loss only if a calibrated probability is introduced;
- factor-family ablation: each family must add held-out value or be removed/reduced;
- manipulation cost: quantified BTC/XCP/counterparties/time needed to move one tier;
- stability across eras, collections, supply scales, and venues;
- explicit false-positive review of high-rated wash/bridge assets and false-negative review of durable grails.

A good rating can remain high for a historically important but quiet asset if the product defines a durable historical-evidence axis. It should not simultaneously claim to predict near-term activity. Those are two different targets and should be displayed separately if users need both.

### Holder conviction

**User decision:** “Is ownership unusually concentrated among established ecosystem participants relative to market attention?”

Success requires incremental prediction of future independent demand after controlling for current value, activity, age, collection, and holder count. If conviction merely reproduces those variables, it should become an explanatory holder-profile panel rather than a score.

Useful outcomes:

- future first sale for currently untraded assets;
- future growth in distinct arm's-length buyers;
- future market-rating improvement;
- downside/error rate for high-conviction assets that never develop independent activity.

### Collection quality

Collection membership and collection quality are separate problems. Membership is a tag/classification task. Quality is an aggregate evidence task.

**User decision:** “Does this collection show broad, durable strength rather than one exceptional card or one operator?”

A collection profile should expose separate axes:

- **coverage:** confirmed assets and membership confidence/provenance;
- **market depth:** median and upper-quartile asset market rating, not maximum alone;
- **breadth:** share of assets with independent buyers and meaningful holders;
- **creator track record:** robust aggregation across distinct issuer identities;
- **collector conviction:** independent established holders, concentration-adjusted;
- **persistence:** active months/years and recent breadth;
- **integrity:** wash/self-dealing/concentration flags as a separate warning layer.

Aggregation rules should require minimum coverage, use medians or trimmed means, and cap contribution per issuer/address. Publish sample size. A two-asset collection and a 1,000-asset collection should not receive equally confident grades.

Collection success can be evaluated by future breadth: how many different member assets later gain independent buyers, retain holders, or trade in multiple periods. The model must beat simple collection size, best-card score, and total-volume baselines.

### Tags and collection membership

**User decision:** “What is this entity, and why do we believe that label?”

Success metrics:

- precision and recall against audited samples per tag/source;
- provenance coverage: percentage of tags with a named source and method;
- freshness lag from an on-chain/source change to the tag update;
- conflict rate between sources and time to resolve the review queue;
- deterministic replay: rebuilding from the same canonical inputs yields the same tags;
- zero ownership collisions between curated, computed, and external tag writers.

Tags such as protocol/media facts should target near-100% precision. Discovery/candidate tags may trade precision for recall but must be labeled as inferred. A collection page should never hide whether membership came from an issuer rule, official list, external index, or manual curation.

### Network standing

**User decision:** “How close is this entity to several independently selected established or risky regions of the observed network?”

Success metrics:

- incremental held-out prediction beyond non-graph features;
- known-good coverage and known-bad recall on labels not used as seeds;
- contamination among trusted/distrusted tiers;
- stability across reasonable seed partitions and edge definitions;
- resistance to one-, two-, and three-seed-subset attacks, dusting, airdrops, rings, and new-address farms;
- sensitivity report showing which seeds and edge families caused the classification.

Seed nodes must be excluded from evaluation. Otherwise the graph receives credit for reproducing axioms it was directly given.

## Product presentation target

The clearest public shape is a profile, not one omniscient score:

1. a coarse primary tier tied to one named decision (address track record or asset market evidence);
2. two to four independent axes, such as durability, independent demand, distribution, and network standing;
3. evidence strength (`limited`, `moderate`, `strong`) with observation counts and time span;
4. factual/curated safety flags shown separately;
5. a plain-language “why” breakdown and methodology/version link;
6. `Untraded`, `Dormant`, and `Unscored` rather than fabricated precision.

Numeric 0–100 ranks can remain as detail, but must be labeled as population-relative rank scores. Do not present them as probabilities. Tier meanings should say what evidence exists, not predict investment return or declare artistic quality.

## Model acceptance gate

A proposed model or weight change ships only when a checked-in evaluation report shows:

1. no temporal leakage and clearly defined eligible populations;
2. improvement over the simple baselines on at least two historical cutoffs;
3. no material regression for a major era/persona/venue cohort;
4. acceptable rank/tier stability;
5. documented manipulation-cost and graph attack results;
6. a factor/seed ablation explaining where improvement came from;
7. human review of named top gains, top losses, false positives, and false negatives;
8. updated public methodology and calibration snapshot.

Initial numeric acceptance thresholds should be set after generating the baseline distributions; choosing them now would be another unsupported judgment. Once baselines exist, freeze the thresholds before testing challenger models.

## First historical baseline results

The initial leakage-safe evaluator (`npm run evaluate:reputation -w xcp-api`) uses three cutoffs—2025-01-01, 2025-07-01, and 2026-01-01—and a 180-day outcome window. Features stop at the cutoff; outcomes begin strictly after it. Current signal snapshots are prohibited.

### Asset market persistence

Eligible population: assets with at least one canonical trade by the cutoff. Future return means at least one canonical trade in the following 180 days; persistence means trading in at least two future calendar months; buyer breadth means at least two future distinct buyers.

| Predictor       | Return lift range | Persistence lift range | Buyer-breadth lift range |
| --------------- | ----------------: | ---------------------: | -----------------------: |
| Active months   |        6.13–7.66× |             8.57–9.01× |               8.55–8.69× |
| Recency         |        5.88–6.46× |             7.74–8.69× |               7.35–8.43× |
| Sales           |        5.51–6.79× |             7.78–8.22× |               7.74–7.80× |
| Distinct buyers |        5.41–6.25× |             7.61–8.04× |               7.23–7.74× |
| Realized USD    |        5.08–6.87× |             6.61–7.97× |               6.99–7.73× |

Only 4.76–7.43% of eligible assets returned in each future window. Prior active-month breadth is the strongest and most stable simple predictor. Historical realized USD is not the strongest predictor of future market persistence, especially in the newest cutoff. This supports displaying historical market evidence separately from expected continued activity.

### Address return activity

Eligible population: addresses that originated at least one supported Counterparty transaction by the cutoff. Incoming activity is excluded so an unsolicited transfer cannot create reputation. Future return means originating another supported transaction in the following 180 days; persistence means activity in at least two future months.

| Predictor         | Return lift range | Persistence lift range |
| ----------------- | ----------------: | ---------------------: |
| Recency           |        7.35–8.57× |             8.85–9.39× |
| Active months     |        5.36–6.47× |             6.24–7.67× |
| Transaction count |        4.79–5.23× |             6.41–6.55× |

Only 0.56–1.01% of eligible addresses returned in each future window. Recency is the baseline to beat for future participation. A rich address track-record score may still describe historical contribution, but it should not claim superior prediction of return until it beats this baseline out of sample.

### Evaluation operating cost

The asset query read about 7.1 million rows and used about 9 seconds of D1 SQL time. The first address run read about 54.8 million rows and used about 72 seconds. The address methodology is sound but too expensive for rapid iteration against canonical D1. Repeated experiments should use a compact, reproducible analytics snapshot or separate analytics database—not a new serving dependency and not another production compatibility layer.

### First family-budget challengers

The first challenger averaged within-cutoff feature percentiles, giving each conceptual family equal influence rather than allowing raw scales or correlated event counts to dominate.

For assets, `balanced_market` combines recency, active-month breadth, distinct buyers, and realized USD. It beat the strongest single baseline (`active_months`) at all three cutoffs:

| Cutoff     | Active-month return lift | Balanced return lift | Active-month persistence lift | Balanced persistence lift |
| ---------- | -----------------------: | -------------------: | ----------------------------: | ------------------------: |
| 2025-01-01 |                   7.659× |               7.834× |                        8.813× |                    9.154× |
| 2025-07-01 |                   6.749× |               6.866× |                        9.010× |                    9.045× |
| 2026-01-01 |                   6.127× |               6.157× |                        8.574× |                    8.700× |

Buyer-breadth lift also improved at every cutoff. The gain is small but consistent. Decision: **retain as a challenger**, not yet a production replacement.

For addresses, `balanced_participation` combines recency, active-month breadth, and transaction frequency. It lost to recency alone on return and persistence at every cutoff:

| Cutoff     | Recency return lift | Balanced return lift | Recency persistence lift | Balanced persistence lift |
| ---------- | ------------------: | -------------------: | -----------------------: | ------------------------: |
| 2025-01-01 |              7.345× |               7.101× |                   9.035× |                    8.114× |
| 2025-07-01 |              7.856× |               7.420× |                   8.849× |                    8.773× |
| 2026-01-01 |              8.573× |               7.901× |                   9.389× |                    8.836× |

Decision: **reject as a return predictor**. Keep recency as a separate predictive axis. A richer address score can still describe historical track record, but combining activity dimensions does not make it a better forecast.

Adding percentile windows raised the address evaluation to roughly 67.5 million rows read and 89.8 seconds of D1 SQL time. Do not iterate this query repeatedly against canonical D1; construct only the compact cutoff-safe snapshot needed for offline comparison.
