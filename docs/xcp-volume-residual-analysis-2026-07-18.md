# XCP unattributed reported-volume residual

Date: 2026-07-18

This report describes what remains after subtracting exact named-venue USD notionals from CoinMarketCap's aggregate
reported USD volume. It does not reconstruct Poloniex, Bittrex, Bter, or any other venue, and it does not recover an
omitted venue price.

The immutable daily data is in
[`xcp-volume-residual-2026-07-18.json`](./data/xcp-volume-residual-2026-07-18.json). It covers the 3,439 official CMC
CSV days from 2014-02-15 through 2023-07-18. The source CSV hash exactly matches the production import manifest.

## Method

- CMC is its official aggregate reported USD volume.
- Zaif XCP/BTC is the sum of every first-party execution's BTC notional converted by selected same-day BTC/USD.
- Zaif XCP/JPY is the sum of every first-party execution's JPY notional converted by official ECB JPY/USD, with the
  existing maximum four-calendar-day weekend/holiday bound.
- Counterparty DEX is the exact BTC notional of every completed XCP/BTC match converted by selected same-day BTC/USD.
- Residual is CMC minus both Zaif markets minus Counterparty DEX. Negative values are preserved.

All 346,960 Zaif executions used by the two XCP markets converted successfully. Named volume is reconstructed from
individual executions rather than daily median price multiplied by daily volume.

## Result

| Component                      | Reported or reconstructed USD |
| ------------------------------ | ----------------------------: |
| CMC aggregate reported volume  |               $622,942,470.07 |
| Zaif XCP/BTC                   |                 $3,565,105.06 |
| Zaif XCP/JPY                   |                $61,627,130.49 |
| Counterparty DEX XCP/BTC       |                   $466,917.86 |
| All named components           |                $65,659,153.41 |
| Unattributed reported residual |               $557,283,316.66 |

Named evidence exists on 2,688 days; 751 CMC days have no named-venue component. The residual is negative on 450 days,
and 478 days also have severe price disagreement in the independent B1 diagnostic.

The large positive residual in 2017 and 2018 is consistent with substantial reported activity outside Zaif and the
Counterparty DEX. It likely includes historically material venues such as Poloniex, Bittrex, and Bter. The data cannot
identify their individual shares, and the residual may also include CMC constituent changes, timing differences,
filters, or unreliable exchange-reported volume.

Negative residuals are concentrated later, including 179 days in 2020 and 91 of the 199 covered days in 2023. This
proves why the result must not be clamped or relabeled as verified omitted-venue volume. On those days, independently
reconstructed named activity exceeds CMC's aggregate reported value, revealing methodology, timing, constituent, or
reporting incompatibility.

## Decision

Use the residual only as descriptive evidence of unattributed reported activity by day and era. Do not:

- call it Poloniex or Bittrex volume;
- use it as a selected price observation;
- infer an omitted venue price from it;
- use it as a liquidity floor without preserving negative days and coverage regimes;
- add it to named venue totals as though it were independently verified.

The result supports the historical conclusion that Zaif was not the whole XCP market, especially in 2017–2018. It
does not weaken the decision to retain CMC as a broad aggregate price or Zaif XCP/JPY as the strongest attributable
corroboration path.
