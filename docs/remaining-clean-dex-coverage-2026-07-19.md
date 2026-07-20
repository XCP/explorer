# Remaining clean DEX coverage

After the conservative CMC promotion, 31,190 completed order matches remain outside the canonical trade ledger. Of
these, 20,528 involve at least one `low_quality` asset and are outside this review. The remaining **10,662 clean
matches** are the relevant unresolved population.

## Shape of the remainder

| Cohort | Matches |
| --- | ---: |
| Known collection-currency network | 8,400 |
| Other clean alt-to-alt network | 2,262 |
| **Total** | **10,662** |

The largest currency-leg counts are PEPECASH 3,560, BITCRYSTALS 1,342, BITCORN 1,017, MAFIACASH 1,001, WILLCOIN
725, DANKMEMECASH 715, and RUSTBITS 51. A match can appear in two leg counts, so they must not be summed.

## PEPECASH remainder

The 3,560 PEPECASH matches span 738 UTC days, 889 other assets, and 2020-05-06 through 2026-07-12.

| Evidence class | Matches | Days |
| --- | ---: | ---: |
| No qualifying same-day lane | 1,170 | 370 |
| Dispenser-only, below conservative activity/continuity gate | 816 | 172 |
| XCP-only, below conservative activity/continuity gate | 495 | 97 |
| Dual paths disagree by more than 50% | 294 | 16 |
| Dual paths disagree by 10–25% | 315 | 37 |
| Dual paths disagree by 25–50% | 376 | 36 |
| XCP-only: at least 10 executions plus causal continuity gate | 46 | 3 |
| Dispenser-only: at least 10 executions plus causal continuity gate | 48 | 7 |

The classes are mutually exclusive and sum to 3,560.

## Lower-confidence PEPECASH sensitivity

A bounded estimated-payment tier can add **785** matches without price interpolation:

1. When both eligible same-day paths exist and disagree by at most 50%, use their geometric mean. This adds 691
   matches. The geometric mean treats the two paths symmetrically in log-price space and limits either path's leverage.
2. When only one same-day path exists, require at least 10 executions. For the dispenser path, the existing two-seller
   minimum still applies. Require the candidate to be within 2x of the most recent selected PEPECASH observation, no
   more than 14 days earlier. The prior value is only an outlier admission guard; it is not carried as the price. This
   adds 94 matches.
3. Preserve exact UTC-day conversion, depth-two provenance, and a fidelity below CMC aggregate or strict dual-path
   evidence. Reject all other days.

### Empirical checks

On historical CMC-overlap days, the high-activity causal single-lane rule produced:

| Lane | Validation days | Median proportional error | P90 | Within 25% | Over 2x |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dispenser | 58 | 18.2% | 36.5% | 38 | 0 |
| XCP DEX | 259 | 10.9% | 44.5% | 191 | 0 |

For dual-path geometric means, the 10–25% path-disagreement cohort had 20.5% median error and 53.0% P90 error against
CMC; the 25–50% cohort had 14.5% median and 53.7% P90. Each cohort contained one CMC comparison exceeding 2x. This is
adequate only for an explicitly lower-confidence historical payment estimate, not a reference or fair-value claim.

If materialized, the clean unresolved population falls from **10,662 to 9,877**. The 2,775 remaining PEPECASH matches
stay null: 1,170 without a same-day lane, 1,311 lower-activity single-lane matches, and 294 severe dual-path conflicts.

## Other roads

- BITCORN has 53 remaining matches on days with at least two direct XCP executions, but those days failed the existing
  distinct-address or within-day dispersion gate. Do not relax the rule for 53 rows after observing its catastrophic
  tail.
- MAFIACASH has 49 analogous matches, BITCRYSTALS 36, DANKMEMECASH 13, and WILLCOIN 6. These are too small to justify
  weakening the reviewed bridge policy individually.
- Fully unanchored networks should remain null. Recursive conversion would convert graph connectivity into fabricated
  price evidence.

## Recommendation

Materialize the 785-match PEPECASH sensitivity only if the product exposes it as a lower-confidence estimated payment
tier. Stop at 9,877 clean unresolved matches afterward. Further reduction would predominantly require interpolation,
lower-activity single paths, or rules relaxed specifically to capture already observed rows.

## Bounded historical interpolation sensitivity

CounterTools demonstrates a useful design pattern: admit only one-hop routes, apply explicit freshness bands, reject
outliers in log-price space, and preserve confidence/provenance. Its current-price methodology cannot be copied directly
into execution-day history, however: a nearby or future anchor is evidence for an ex-post estimate, not proof of the USD
price known or executable at the trade time.

We therefore tested **bracketed log-linear interpolation** between two already-selected bridge prices. The candidate is
admitted only when the trade day lies strictly between the anchors; there is no extrapolation and no recursive routing.
BITCRYSTALS days rejected by the CMC/Zaif comparison remain blocked so interpolation cannot route around a known bad day.

| Maximum total anchor-to-anchor span | Interpolation matches | Union with 785 same-day candidates | Clean unresolved |
| --- | ---: | ---: | ---: |
| 3 days | 301 | 1,053 | 9,609 |
| 7 days | 1,363 | 2,093 | 8,569 |
| 14 days | 2,147 | 2,721 | 7,941 |
| 30 days | 3,664 | 3,785 | 6,877 |

The seven-day row is stricter than CounterTools' `+/-7 day` band: the two anchors together may span no more than seven
days. Leave-one-day-out tests are strong for dense PEPECASH and BITCRYSTALS series and adequate for WILLCOIN and
BITCORN. MAFIACASH and RUSTBITS degrade materially as the window grows; DANKMEMECASH has too few withheld observations
to support a strong validation claim. These tests measure temporal smoothness, not independent price truth, and CMC's
dense series partly validates the consistency of the same provider.

The defensible stopping point is therefore **8,569 clean unresolved** if the 785 same-day estimates and seven-day
bracketed estimates are stored as a separate historical-estimate tier. For a stricter publication surface, exclude the
weak MAFIACASH/RUSTBITS interpolations or limit those lanes to three days. Fourteen- and thirty-day interpolation should
remain sensitivity analysis: they improve the headline count, but the evidence does not justify presenting them as
execution-day USD value.

Applying deterministic evidence priority (same-day estimate before interpolation), the 2,093-trade union represents
approximately **$236,234.96** in estimated USD volume. The 785 same-day estimates contribute **$169,830.36**; the 1,308
interpolation-only additions contribute **$66,404.60**. The raw seven-day interpolation set contains 1,363 admitted
matches worth $73,384.28, including 55 overlaps with the same-day set. The 89 BITCRYSTALS matches on explicitly rejected
CMC/Zaif disagreement days are not admitted through interpolation.
