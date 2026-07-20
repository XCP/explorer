# USD bridge-asset survey

Date: 2026-07-18

This survey asks which non-anchor Counterparty assets have both attributable USD conversion evidence and completed
trades against other assets. The reproducible result is
[`usd-bridge-assets-2026-07-18.json`](./data/usd-bridge-assets-2026-07-18.json).

The comparison applies one common rule: same-day Zaif asset/JPY and asset/BTC observations, at least two executions in
each market, overlapping intraday observation windows, no asset-price carry, ECB reference carry capped at four days,
and no more than 25% path disagreement. Trades between bridge candidates and BTC/XCP are excluded from downstream
counts so the survey measures genuinely additional other-asset coverage.

| Candidate | Admitted price days | Other-asset matches | Matches on admitted days | Other assets reached | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| PEPECASH | 851 | 43,428 | 25,312 | 1,926 | Established evaluation case |
| BITCRYSTALS | 196 | 10,434 | 1,241 | 208 | Proceed to exact admission census |
| SJCX | 144 | 21 | 0 | 0 | Price and trade periods do not overlap |
| ZAIF | 1,743 | 0 | 0 | 0 | Good anchor history, no downstream use |
| CICC | 782 | 0 | 0 | 0 | Good anchor history, no downstream use |

BITCRYSTALS is the only newly useful bridge in the retained data. Its two paths overlap on 407 days; 184 days are
within 10% and 305 are within 25% before activity and time-window gates. The complete conservative rule admits 196
days from 2016-08-07 through 2020-04-16, reaching 1,241 completed matches against 208 other assets.

This is sufficient to justify a row-level BITCRYSTALS census using the already frozen rule structure. It is not yet a
production admission: the census must retain orientation, both path values, executions, volumes, observation windows,
and rejection reasons, then review largest payments and disagreement tails. There is no empirical reason to enable an
arbitrary recursive conversion graph as a side effect.

## Research consistency

The current approach remains within a reasonable market-microstructure model because it retains observations rather
than manufacturing one latent truth, caps path depth and staleness, rejects cycles, requires activity, compares
independently anchored paths, preserves nulls, and separates selected payment conversion from lower-confidence
estimates and market-cap claims.

The main research risks are post-hoc regime design, treating repeated/stale prices as new information, and choosing a
path because it makes the purchased asset resemble its prior price. The implementation avoids the latter two, while
new regimes must continue to be named and evaluated out of sample before selection.

This interpretation is consistent with nonsynchronous-trading and illiquidity research showing that stale or smoothed
prints distort variance and autocorrelation; crypto price-discovery research showing that venue leadership and
microstructure noise differ; and crypto arbitrage research showing that indirect conversion paths can diverge even
when a theoretical no-arbitrage relationship exists. The literature supports explicit liquidity, noise, path, and
uncertainty controls. It does not supply universal numerical thresholds for this dataset.

The model would leave reasonable territory if it assigned every graph-reachable asset a scalar USD price, carried
thin bridge prices indefinitely, recursively reused estimates as anchors, hid path disagreement, or selected rules by
maximizing coverage on the same sample used for evaluation.
