# Graph reputation — literature review & Phase C design basis

*2026-07-06. Deep-research harness: 106 agents, 25 falsifiable claims extracted from primary sources,
24 confirmed under 3-vote adversarial verification. Primary sources: Gyöngyi et al. (TrustRank,
VLDB 2004), Whang et al. (Anti-TrustRank/Min-k-PPR, MIS2/WSDM 2018), Cheng & Friedman (sybilproofness
impossibility), SybilRank/SybilGuard evaluations, PHT (Personalized Hitting Time) literature.*

## The verdict

**Seed-personalized (biased) PageRank is the right family — but only in hardened form.** Everything
else we considered is disqualified by proof or measurement.

### Recommended: Min-k-PPR TrustRank + Anti-TrustRank (rank #1)

- Component-wise **minimum of k personalized-PageRank vectors**, each teleporting to a *subset* of
  the trusted seeds (an attacker must be near ALL seed subsets, not just one).
- A **reverse-graph Anti-TrustRank** run from the known-scam seeds; final score = trust − distrust.
- **ACL-style degree normalization** blunts exchange/dispenser hub domination.
- Cost at our scale is proven, not estimated: a push-variant converged in ~2.5M arithmetic ops on a
  **584k-node / 2.5M-edge graph — nearly identical to our money-flow graph**; ~20 sparse passes
  (SQL UPDATE-JOIN per pass) suffice for stable ordering; convergence depends on damping, not size.
- Precision evidence: with only **1% of nodes labeled**, top Anti-TrustRank buckets were
  **99.9-100% spam**. TrustRank left virtually no spam in top buckets where plain PageRank had
  20-50%.
- **We already have the required ground truth**: the curated grails + issuers (trust seeds), the
  curated scam/low-quality lists (distrust seeds), exchange/burn lists (to exclude or down-weight).

### Second scorer: Personalized Hitting Time (rank #2)

Monte Carlo multi-walk sampling from the same seeds. Uniquely among PHT/PPR/EigenTrust-family
mechanisms, **adding sybils yields zero additional benefit** — whereas raw PPR can be gamed with a
single two-loop sybil (~70 ranks out of 500). Use as a robustness cross-check on the Min-k-PPR
output, not necessarily a shipped factor.

### Explicitly rejected (with proofs)

- **Unpersonalized PageRank**: one free "petal" sybil = 4.7× value; at ~300k nodes (our scale) a
  median node reaches top-100 with ~500 sybils, top-1% with <76.
- **EigenTrust and all symmetric reputation functions**: provably non-sybilproof (no parameter
  tuning fixes an impossibility result).
- **HITS / bipartite hubs-authorities**: same impossibility class. (Our internal instinct — iterate
  "good assets ↔ good holders" on the balance graph — is rejected in its symmetric form. The
  *seeded* way to capture the same intuition is to include holder↔asset edges in the Min-k-PPR
  graph so trust flows grails → their holders → what those holders hold.)
- **SybilRank/SybilGuard-family global classification**: falls to or below random accuracy under
  the isolated-node/many-attack-edge pattern that free address creation enables; accuracy strongly
  anti-correlated with community structure (r = −0.81 with modularity).

## The coverage caveat (design constraint, not a flaw)

Seeded PPR only reaches nodes with inbound paths from seeds; in the original study a third of all
nodes scored exactly zero. For us this cuts both ways: **fresh sybils default to zero trust
(resistance by default), but legitimate newcomers are unscored, not "bad."**

**UI consequence (binding):** graph trust is presented as **trusted / distrusted / unscored**
tiers — never a 0-100 continuum — and the zero-score fraction is a monitored metric.

## Validation plan on our data (before any factor weight)

1. Hold out a slice of curated labels; measure precision@k of top trust/distrust buckets.
2. Inject synthetic petal/two-loop sybils; compare rank inflation across plain PPR vs Min-k-PPR vs
   PHT (the hardened variants must not move).
3. Measure the money-flow graph's modularity + the zero-score coverage fraction to size the known
   failure modes.
4. The existing gates still apply: it enters `config.ts` as ONE factor with modest weight only if it
   beats the one-step features it generalizes (incremental vaulted-lift/grail-margin over
   `avg_holder_dex` alone).

## Implementation sketch (Phase C, when scheduled)

Edges table (address→address from sends/trades/dispenses with origin-aware attribution, plus
optionally holder↔asset edges), out-degree normalized. k seed subsets from `curated` kinds. ~20
UPDATE-JOIN passes per seed subset as a weekly `heavyEveryBlocks`-style job (minutes, bounded);
reverse pass from scam seeds; store `graph_trust`, `graph_distrust`, tier by threshold. All
rebuildable, Layer-2 rules apply (derived, never contaminates mirrors).

## H4 verdict (2026-07-06, first prod cycle — experiment closed)

Tested adding `ln(1+graph_trust×1e6)` to ASSET_FACTORS at w ∈ {0.6, 1.0} against the money-flow
baseline, read-only. Grails are unusable as the gauge (they're seeds — axiom trust makes the margin
circular), so the independent vaulted label decides: mean gap 22.90 → 23.38 (w=0.6, +2.1%) → 23.70
(w=1.0, +3.5%); mean ratio degrades 2.18 → 1.96 (shared-offset compression). **Below the
pre-registered incremental bar → graph trust takes NO score weight.** Its production value is the
displayed tier trait + the distrust curation queue (first harvest: 14 assets curated 2026-07-06,
which feed back as seeds). Re-run this experiment only if the edge model changes materially
(e.g. the bipartite variant) — same gauge, same bar.
