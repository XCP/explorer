# PEPECASH/USD offline candidates

Date: 2026-07-18

This completes roadmap C1 without writing any PEPECASH row to the selected production `prices` calendar. The immutable
candidate census is [`pepecash-usd-candidates-2026-07-18.json`](./data/pepecash-usd-candidates-2026-07-18.json).

## Predeclared paths

Only two acyclic, depth-two paths are constructed:

- `PEPECASH → JPY → USD`: same-UTC-day Zaif PEPECASH/JPY volume-weighted median, converted by the official ECB
  EUR/USD and EUR/JPY cross. Weekend or holiday FX may carry for at most four calendar days.
- `PEPECASH → BTC → USD`: same-UTC-day Zaif PEPECASH/BTC volume-weighted median, converted by the already selected
  daily BTC/USD calendar.

PEPECASH market prices never carry. No XCP path, arbitrary graph search, current quote, or recursive PEPECASH price is
allowed.

## Coverage

| Measure                             |     Result |
| ----------------------------------- | ---------: |
| Any Zaif PEPECASH market day        |      1,201 |
| JPY path days                       |      1,201 |
| BTC path days                       |        971 |
| Both paths                          |        971 |
| Neither path                        |          0 |
| JPY paths using carried official FX |        364 |
| First market day                    | 2017-01-13 |
| Last market day                     | 2020-04-28 |

The JPY archive contains 852,648 exact executions and the BTC archive contains 41,187. Each daily candidate retains
executions, PEPECASH volume, first and last execution time, market day and method, conversion source and observed day,
conversion age, derivation depth, and complete named path.

The report binds the 115-file archive for each Zaif pair to a canonical manifest SHA-256. Some later monthly files are
valid empty archives, which is why the source manifests continue beyond the last observed execution day. Empty rows
do not create candidates.

## Interpretation

Coverage alone is not admission. The 971 overlapping days now permit the predeclared agreement evaluation in C2.
The 230 JPY-only days are single-path evidence and require a separate admission decision; they must not inherit the
quality of overlap days. The 364 carried-FX days are preserved as their own cohort rather than mixed silently with
exact-FX days.

No production valuation, dispenser conversion, asset market capitalization, collection capitalization, or portfolio
value changes as a result of this artifact.
