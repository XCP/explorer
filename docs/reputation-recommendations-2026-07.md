# Reputation and rating recommendations

Status: decision draft after leakage-safe historical evaluation. Production score changes remain gated where noted.

## Product contracts

| Product | Decision it supports | It must not claim |
| --- | --- | --- |
| Address track record | How substantial, sustained, and independently connected is this address's observed Counterparty history? | That the owner is trustworthy or will return |
| Asset market evidence | How broad, durable, and economically meaningful is this asset's demonstrated market history? | Investment quality or future return |
| Asset activity outlook | How likely is activity to continue over a named horizon relative to historically comparable assets? | Calibrated probability until calibration passes |
| Network standing | Where does the address sit relative to independently selected network regions? | Identity, intent, or trust from proximity alone |
| Collection profile | How well-supported, broad, active, typical, and concentrated is this membership set? | One objective artistic-quality grade |

Safety flags and factual protocol tags remain separate from every score.

## Prioritized recommendations

### 1. Separate asset market evidence from activity outlook — do now

Reason: historical significance and future persistence optimize for different targets. Active-month breadth and recency are stable predictors of 180-day activity. Realized USD is meaningful historical evidence but reverses as a predictive input in the newest regime.

Implementation target:

- retain historical market evidence as the primary descriptive asset rating;
- add a separately named activity outlook led by active months and recency;
- label both with observation span and evidence strength;
- do not describe either as investment quality.

Acceptance: API and UI contracts use distinct names, factor explanations, and methodology text. No weight change is required merely to make the distinction honest.

### 2. Use the two-factor persistence core as the activity-outlook baseline — test next

Reason: the whole-ranking evaluation strengthens the simple model. Against the USD-weighted compact challenger, `active months + recency` wins NDCG at all three historical cutoffs. In the newest cutoff it also wins precision at 100 (90% vs 81%), precision at 500 (62.4% vs 56.6%), average precision (0.460 vs 0.413), and NDCG (0.884 vs 0.873).

The four-factor balanced model improves top-decile lift at all cutoffs, but loses average precision and NDCG to active months in the newest cutoff. It is not robust enough to ship as the default outlook.

Acceptance before production: subgroup results for new versus established assets, venue/era stability, named false-positive review, and a frozen worst-cutoff regression threshold.

### 3. Keep address reputation historical; show recency separately — do now

Reason: recency beats the balanced participation challenger on return and persistence at every cutoff. A richer historical contribution score can still be useful, but calling it predictive would be unsupported.

Implementation target: preserve the track-record breakdown and add a factual last-active/active-span treatment rather than blending more recency into a supposedly timeless reputation number.

### 4. Build one compact analytics snapshot — next infrastructure task

Reason: asset AP/NDCG evaluation read 18.2 million rows and consumed 22.8 seconds of D1 SQL. The analogous address query exceeded D1's CPU limit after 115 seconds. Repeated experimentation must not compete with serving traffic.

The snapshot is an evaluation artifact, not a serving database, compatibility adapter, or new production source of truth. It should contain only cutoff-safe entity features, outcomes, cohort labels, and stable identifiers; its build must be reproducible from canonical tables.

Acceptance: identical aggregate baseline results versus D1, immutable cutoff manifests, row counts/checksums, and no application runtime dependency.

The first bounded snapshot completed for the 2026-01-01 cutoff with 213,909 eligible addresses and 1,191 future returners. Its aggregate results reproduce the prior canonical D1 evaluation after rounding: recency return lift 8.573 and persistence lift 9.389; balanced participation return lift 7.901 and persistence lift 8.836. The snapshot additionally shows that balanced participation wins the very top review budget (83% precision at 100 versus 69%), while recency wins across the ranking (average precision 0.304 versus 0.283; NDCG 0.819 versus 0.811). This supports a factual track-record profile plus separate recency, not a blended universal score.

The artifact is built from exact timestamp boundaries in bounded source-ID ranges, resumes from immutable chunk files, records a fixed build frontier, hashes every chunk, and binds the ordered chunk manifest with a content checksum. It is local evaluation machinery only and is git-ignored.

All three address snapshots now reproduce the original D1 lift results and add whole-ranking metrics:

| Cutoff | Model | Precision @100 | Return lift | Persistence lift | Average precision | NDCG |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2025-01-01 | Recency | 49% | 7.345 | 9.035 | 0.208 | 0.792 |
| 2025-01-01 | Balanced participation | 91% | 7.101 | 8.114 | 0.295 | 0.827 |
| 2025-07-01 | Recency | 53% | 7.856 | 8.849 | 0.250 | 0.810 |
| 2025-07-01 | Balanced participation | 88% | 7.420 | 8.773 | 0.273 | 0.819 |
| 2026-01-01 | Recency | 69% | 8.573 | 9.389 | 0.304 | 0.819 |
| 2026-01-01 | Balanced participation | 83% | 7.901 | 8.836 | 0.283 | 0.811 |

Decision: **reject one universal address predictor**. Recency is the stable activity-outlook baseline because it wins return and persistence lift at every cutoff and wins full-ranking quality in the newest regime. Balanced participation is a separate high-precision review signal: it wins precision at 100 dramatically at every cutoff, but its whole-ranking advantage does not survive the newest regime. Raw transaction frequency is rejected as a primary predictor; it is consistently the weakest of the tested behavioral rankings.

Presentation consequence: show historical track record, last-active/recency, and evidence strength separately. If an internal review queue is useful, balanced participation may order a bounded shortlist, but it must not be relabeled as public reputation or future-return probability.

### 5. Present collection profiles before considering a grade — do next

Reason: membership evidence is now normalized and 7,671 memberships have multi-source corroboration. Collection behavior differs too much for total volume or maximum-card quality to be representative.

Expose:

- membership sources and evidence count;
- member count and market coverage;
- median member evidence and activity;
- issuer, event, and value concentration;
- limited/moderate/strong evidence strength.

Do not create one collection grade until time-aware membership data supports leakage-safe validation.

### 6. Admit graph factors only on incremental evidence — later

Reason: network algorithms can reproduce volume, infrastructure hubs, seed choices, or Sybil structure while appearing sophisticated. A graph factor must improve held-out outcomes beyond ordinary behavioral features and survive seed, edge-family, dusting, ring, and address-farm sensitivity tests.

Until then, graph results remain useful for related entities, exploration, anomaly review, and transparent network-standing detail—not the primary reputation tier.

### Live graph evaluation correction

The production scorecard previously reported 100% recall for 65 curated low-quality assets and one derived scam address. This was circular: all 66 labels were direct distrust seeds. The scorecard now separates seed reproduction from held-out detection and correctly reports **no held-out bad labels**. Distrust propagation therefore has no measured recall yet.

Other live findings:

- 19,528 addresses are classified trusted, but 84.6% are dormant for more than one year;
- after excluding direct trust seeds, 16,864 propagated addresses remain trusted and 89.1% are dormant;
- only one established clean asset is classified distrusted and distrust-tier market contamination is 0.7%, which is encouraging but does not establish predictive or reputational validity;
- Radar has 11,332 otherwise eligible assets; its graph gate admits 6,444 and excludes 4,888 (43.1%);
- 3,826 of those admitted assets (59.4%) are direct trust seeds, so the gate often reproduces collection/quality curation rather than independently validating it;
- the graph factor is near zero for most assets but becomes material in the highest graph decile, making its influence concentrated rather than uniformly small.

Decision: **do not describe current graph tiers as validated reputation or trust**. Keep the graph available as network standing and an exploratory explanation. Before it remains a hard Radar eligibility gate or a Conviction factor, run two ablations: Radar/Conviction with versus without graph influence, and held-out graph evaluation where seed labels are partitioned before propagation. The 89.1% held-out dormancy rate makes temporal edge decay the first graph variant worth testing.

## Remaining decision gates

1. Produce subgroup and false-positive reviews for the two-factor asset outlook.
2. Build the compact historical snapshot and finish address AP/NDCG without using serving-query CPU.
3. Measure graph features incrementally against the non-graph baselines.
4. Specify collection-profile API fields and validate concentration calculations.
5. Convert accepted recommendations into small, independently reversible implementation changes.

The project is now in recommendation and validation mode, not open-ended model discovery. Items 1, 3, and the product naming in item 5 have enough evidence to proceed; predictive weight changes and any collection grade do not.
