# Production Asset Rating Review

Date: 2026-07-16

## Purpose

This review checks the face validity of the production 0–10 Asset Rating against 50 deliberately selected assets. It
does not tune the model to anecdotes. It asks whether the validated three-component market model produces results a
knowledgeable user can understand, and turns surprising results into data-contract tests.

Rating is a relative rank of clean secondary-market evidence. It equally combines percentile-ranked active trade
months, distinct paid buyers, and realized USD value, then ranks the combined evidence across all eligible assets.
It is not a probability, appraisal, condition grade, or recommendation.

## Cohort

The cohort was selected before interpreting the corrected results. Categories are review strata, not model inputs.

| Stratum                      | Assets                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Established and grails (12)  | XCP, PEPECASH, SHITCOINCARD, GOXPEPE, STILLPEPE, HAIRPEPE, UFOPEPE, SATOSHICARD, FDCARD, RAREPEPE, BITCORN, BITCRYSTALS |
| Ordinary and mid-market (10) | TESTNETPEPE, DARKPILLPEPE, NINJASUIT, GIVEKUDOS, PEPEREPUBLIC, ZOMBIEPEPES, HYOU, GUERILLA, COMICCOIN, BITSCISSORS      |
| Thin or inactive (8)         | STOCKAMOTO, XAIRGAP, MYSTERYBOX, DOUBLETOP, XBLACKOUT, ELOSHI, UFOATLAS, FREERAREPEPE                                   |
| Newly traded (8)             | FAUXCORNCASH, RAREPIGEON, BOSSCARD, PGNSACRIFICE, PEPECREATURE, HATRSGONHATE, BLOOMERPEPE, FROGDNA                      |
| Integrity-flagged (3)        | OXBT, ORDIPEPE, OGPASS                                                                                                  |
| Free fairmint (5)            | PEPEFAIR, MINTS, FAIRLADY, LFGSUBMIT, TRUMPMINTS                                                                        |
| Paid fairmint (4)            | FADEDNJADED, SYNTHPOET, XCPFUN, XCPFORTWENY                                                                             |

## Corrected production observations

The production population contains 20,982 eligible rated assets. Selected results after repairing the Emblem trade
projection are below; the inputs are the facts users should use to interpret the Rating.

| Asset        |   Rating |   Rank | Active months | Paid buyers | Realized USD | Interpretation                                   |
| ------------ | -------: | -----: | ------------: | ----------: | -----------: | ------------------------------------------------ |
| XCP          |    10.00 |      1 |            99 |       3,838 |      $14.44m | Broad, durable, high-value record                |
| PEPECASH     |    10.00 |      2 |           118 |       2,778 |       $4.57m | Broadest duration in the cohort                  |
| SHITCOINCARD |    10.00 |      3 |            78 |         699 |       $1.80m | Established grail                                |
| GOXPEPE      |    10.00 |      4 |            77 |         305 |       $1.44m | Established grail                                |
| RAREPEPE     |     9.98 |     41 |            33 |         122 |       $9.15m | Exceptional value with less breadth/duration     |
| BITCORN      |     9.96 |     93 |            62 |         159 |       $49.2k | Long-lived market offsets lower value            |
| TESTNETPEPE  |     9.88 |    256 |            56 |         195 |       $15.4k | Strong, but no longer inflated by dump vaults    |
| GIVEKUDOS    |     9.82 |    378 |            47 |         203 |        $9.3k | Broad low-value history                          |
| PEPEREPUBLIC |     9.69 |    641 |            47 |         174 |        $4.0k | Broad low-value history                          |
| ZOMBIEPEPES  |     9.66 |    719 |            45 |         197 |        $3.1k | Broad low-value history                          |
| PEPEFAIR     |     9.40 |  1,250 |             5 |          71 |       $14.5k | Free mint with a real secondary market           |
| FAUXCORNCASH |     8.88 |  2,344 |             5 |          19 |        $1.1k | Credible early evidence, not mature              |
| RAREPIGEON   |     8.88 |  2,355 |             5 |          16 |        $1.3k | Credible early evidence, not mature              |
| PEPEMILLION  |     8.72 |  2,681 |             4 |           5 |       $1.78m | High value cannot fully replace breadth          |
| MINTS        |     8.63 |  2,883 |             3 |          11 |        $4.6k | Free mint; Rating comes from resale only         |
| HYOU         |     7.41 |  5,431 |            11 |          33 |       $23.58 | Duration/breadth with negligible value           |
| XCERPASS     |     7.34 |  5,580 |             3 |           8 |      $133.21 | 9,422 holders do not inflate market Rating       |
| COMICCOIN    |     6.38 |  7,602 |             5 |           5 |        $6.29 | Ordinary low-value evidence                      |
| FREERAREPEPE |     5.12 | 10,241 |             2 |           2 |       $11.32 | Thin free-mint resale record                     |
| STOCKAMOTO   |     3.64 | 13,331 |             2 |           1 |           $0 | Large holder count does not substitute for sales |
| MYSTERYBOX   |     1.36 | 18,138 |             1 |           1 |       $46.79 | Isolated evidence                                |
| DOUBLETOP    |     0.00 | 20,467 |             1 |           1 |           $0 | Minimum eligible evidence                        |
| OXBT         | withheld |      — |            13 |      14,994 |     $395.56m | Explicit integrity flag; fails closed            |
| ORDIPEPE     | withheld |      — |             5 |      16,125 |     $184.76m | Explicit integrity flag; fails closed            |
| OGPASS       | withheld |      — |             5 |       2,292 |      $67.81m | Explicit integrity flag; fails closed            |
| FADEDNJADED  |  unrated |      — |             0 |           0 |           $0 | Paid primary mint, no secondary market           |
| SYNTHPOET    |  unrated |      — |             0 |           0 |           $0 | Paid primary mint, no secondary market           |
| XCPFUN       |  unrated |      — |             0 |           0 |           $0 | Paid primary mint, no secondary market           |
| XCPFORTWENY  |  unrated |      — |             0 |           0 |           $0 | Paid primary mint, no secondary market           |

The omitted cohort rows followed the same monotonic pattern: new assets ranged from 7.77 to 8.46, ordinary assets
from 5.97 to 9.83 depending on actual evidence, and minimum-evidence assets from 0 to 2.95.

## Surprise found and closed

The initial review produced impossible buyer counts: TESTNETPEPE had 8,825 paid buyers, ZOMBIEPEPES 10,379,
GIVEKUDOS 8,847, and PEPEREPUBLIC 7,602. This was not a weighting failure. The canonical `emblem_vaults`
classification marked the relevant vaults as dumps, but 130,910 historical Emblem trade rows had not propagated the
classification into `trades`.

The repair:

1. Reconciled every queued vault and corrected the trade classification and asset attribution.
2. Rebuilt the 414 affected asset-signal rows.
3. Rematerialized Rating once from the converged signals.
4. Verified zero dump or bundle vault sales remain classified as real asset trades.
5. Added regression coverage for a vault changing from legitimate to dump after its sales were projected.
6. Made the trade-to-signal trigger conflict-safe for multi-row upserts.
7. Ordered scheduled projections as trades, then signals, then Rating.

This is the most important outcome of the face-validity review: it found and permanently guarded an upstream data
contract rather than encouraging an ad hoc weight change.

## Fairmint conclusion

Fairmint participation is primary issuance, not automatically independent secondary-market validation. Free and paid
fairmints therefore enter Rating on the same rule: only subsequent clean market activity contributes. PEPEFAIR and
MINTS have Ratings because they developed secondary markets. The selected paid fairmints are correctly unrated because
their paid mints have not yet produced that evidence. Primary-mint demand can be surfaced separately, but folding it
into Rating would mix issuer-controlled distribution with independent resale evidence.

## Decision

Keep the current equal-weight model. After repairing its inputs, the cohort has acceptable face validity:

- established assets occupy the upper tail for understandable combinations of duration, breadth, and value;
- one exceptional high-value sale cannot create a top Rating without breadth and duration;
- holder count and mint count do not leak into a market-evidence Rating;
- integrity flags fail closed even when the raw activity would otherwise rank first; and
- new assets can show promising evidence without being presented as mature markets.

Do not tune weights from this hand-selected cohort. Future changes require a predeclared outcome evaluation and a
fresh holdout. Repeat this review after any trade classification, USD attribution, eligibility, or Rating-model change.
