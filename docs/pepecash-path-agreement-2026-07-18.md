# PEPECASH path-agreement evaluation

Date: 2026-07-18

This completes roadmap C2 without selecting a PEPECASH/USD calendar. Results are reproducible from the immutable
[`agreement report`](./data/pepecash-path-agreement-2026-07-18.json) and its C1 candidate input.

## Predeclared evaluation

The comparison uses absolute natural-log error between same-day `PEPECASH → JPY → USD` and
`PEPECASH → BTC → USD`. Before reading outcomes, cohorts were fixed for executions (1, 2–9, 10+), minimum daily
PEPECASH volume (under 10k, 10k–100k, 100k+), exact versus carried FX, year, and overlapping versus separate execution
windows. Reported bands are fixed at 10% and 25%.

## Overall result

| Measure                     |  Result |
| --------------------------- | ------: |
| Overlap days                |     971 |
| Median absolute log error   |  0.0451 |
| P90                         |  0.1649 |
| P99                         |  0.4693 |
| Within 10%                  |  75.59% |
| Within 25%                  |  94.23% |
| Over 25%                    | 56 days |
| Longest adjacent severe run |  4 days |

Agreement improves with execution count: 88.73% of one-execution days, 91.79% of 2–9 execution days, and 96.42% of
10+ execution days are within 25%. Volume has a weaker monotonic relationship; even high-volume days can disagree
severely.

Carried official FX is modestly worse than exact FX (92.83% versus 94.80% within 25%) but is not the dominant failure
mode. The two Zaif execution windows overlap on 968 of 971 days, so grossly asynchronous daily windows are rare.

## Era dependence and worst dates

Agreement is strongest in 2018, when 99.41% of days fall within 25%, and weakest in 2020, when only 71.60% do. The
2020 median error is 0.1135 and 23 of 81 days exceed 25%. This prevents a global activity threshold from being treated
as sufficient evidence.

The worst day is 2017-08-03: the JPY path is 2.61 times the BTC path. Several April 2020 observations disagree despite
10+ executions or more than 100,000 PEPECASH of minimum path volume. These are retained as rejection examples, not
manually corrected.

## On-chain corroboration

The completed Counterparty matches produce 582 PEPECASH/XCP overlap days but only one PEPECASH/BTC overlap day. Across
the path comparisons generated from those observations, median log error is 0.184 and only 58.34% are within 25%.
This is consistent with thin, asynchronous on-chain price formation. It does not justify an XCP route and is not
ground truth against which Zaif is relabeled correct or incorrect.

## Admission rules predeclared for C3

The exact trade census will evaluate, without changing these rules:

1. Both same-day Zaif path classes must exist; JPY-only and BTC-only days are rejected as missing corroboration.
2. Each path must contain at least two executions. One-execution daily medians are rejected as insufficient activity.
3. The two execution windows must overlap.
4. Absolute natural-log path disagreement must not exceed `ln(1.25)`.
5. The JPY path is the proposed selected observation because it has substantially greater execution evidence; the BTC
   path is independent corroboration, not averaged into a synthetic price.
6. ECB carry remains capped at four calendar days and is exposed in provenance. PEPECASH market prices never carry.
7. Depth remains two, cycles are rejected, and on-chain XCP observations cannot fill a failed Zaif rule.

These rules favor auditable coverage over maximum reach. C3 must report the coverage they actually produce and review
large payments, early matches, severe disagreements, and thin-market samples before any production decision.
