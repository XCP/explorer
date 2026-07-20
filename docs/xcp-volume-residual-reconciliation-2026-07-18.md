# XCP reported-volume residual reconciliation

Date: 2026-07-18

This sensitivity analysis explains the negative tail in the immutable
[`daily residual`](./data/xcp-volume-residual-2026-07-18.json). It does not change selected prices or reinterpret the
residual as venue-level volume.

## Scale and concentration

The residual is negative on 450 of 3,439 days, but the combined shortfall is only **$202,618.15**. That is 0.033% of
CMC's **$622.94 million** aggregate reported volume. On negative days, named components total $890,374.14 against
$687,755.99 reported by CMC.

The count is concentrated after 2018: 110 days in 2019, 179 in 2020, 51 in 2021, 18 in 2022, and 91 through
2023-07-18. Zaif XCP/JPY is present on 446 of the 450 negative days. Only 70 negative days coincide with the severe
price-disagreement flag, and 126 use carried ECB FX. Price disagreement and FX carry therefore do not explain most
negative observations.

## Component sensitivity

| Subtraction rule                               | Negative days | Combined negative shortfall |
| ---------------------------------------------- | ------------: | --------------------------: |
| Zaif XCP/BTC + Zaif XCP/JPY + Counterparty DEX |           450 |                 $202,618.15 |
| Zaif XCP/BTC + Zaif XCP/JPY only               |           399 |                  $79,573.40 |
| Zaif XCP/JPY only                              |           332 |                  $23,586.60 |
| Counterparty DEX only                          |            48 |                  $86,575.09 |

This is consistent with a constituent-set mismatch: CMC's exchange aggregate need not include the on-chain
Counterparty DEX, yet the broad descriptive residual subtracts it. Removing DEX from the sensitivity calculation cuts
the negative shortfall by about 61%. This is evidence about comparability, not proof of CMC's historical constituent
set, which remains unavailable.

The remaining Zaif-only shortfall is small and can arise because CMC's reported daily volume and the sum of raw Zaif
executions need not share identical filters, cutoffs, currency conversion, or snapshot time. It must remain visible;
it must not be clamped.

## Calendar-boundary test

Keeping CMC days fixed and shifting both Zaif components worsens the comparison substantially:

| Zaif day shift | Comparable days | Negative days | Combined negative shortfall |
| -------------: | --------------: | ------------: | --------------------------: |
|             -2 |           3,435 |           471 |               $1,553,879.97 |
|             -1 |           3,437 |           487 |               $1,061,808.83 |
|              0 |           3,439 |           399 |                  $79,573.40 |
|             +1 |           3,437 |           455 |               $1,070,548.69 |
|             +2 |           3,435 |           471 |               $1,238,019.56 |

The unshifted Zaif-only series fits far better than any whole-day shift. This rejects a simple one-day timezone offset
as the dominant explanation, although intraday cutoff and snapshot differences can still affect individual days.

## Named worst cases

The largest shortfall, 2020-12-14, is dominated by $39,910.53 of Zaif XCP/BTC volume versus $1,444 reported by CMC.
Several other large cases are dominated by Counterparty DEX volume that CMC may not have counted, including
2020-08-20, 2020-08-28, 2023-05-27, and 2022-07-06. These observations warrant preservation as source incompatibility
examples, not manual correction.

## Decision

No pricing-policy change is justified. Preserve the original broad residual because it answers the declared
cross-venue accounting question, but accompany it with the Zaif-only sensitivity when discussing negative values.
Treat the negative tail as measured non-comparability among source universes. Do not remove DEX silently, shift days,
clamp values, or infer omitted exchange volume from the remainder.
