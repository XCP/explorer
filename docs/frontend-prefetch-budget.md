# Record navigation resource budget

Dense tables prefetch address and transaction destinations only on mouse hover,
keyboard focus, or touch start. `RecordLink` retains Next's normal link navigation
and calls `router.prefetch` once per selected href. Repeated intent events do not
restart the warm-up; a changed href after pagination can warm independently.

This applies to the shared address/transaction cells and the dispenser/order-match
transaction links in the record registry. Asset and block links keep their existing
behavior. Data polling, API caching, server rendering, and loading/error states are
unchanged. Very fast clicks have less prefetch head start, so production navigation
latency must be checked alongside resource savings.

## Evidence, September 19, 2026 UTC

A 25-second live `xcp-web` tail sample at 01:11 UTC contained:

| Destination | Requests | Requests marked `next-router-prefetch` | CPU spent on those prefetches |
| --- | ---: | ---: | ---: |
| Address | 279 | 237 (85%) | 3,821 ms |
| Transaction | 340 | 213 (63%) | 2,753 ms |

All those prefetch responses were HTTP 200. Tail redacts many address/transaction
paths: distinct-path counts cannot establish cache reuse or traffic provenance.
This short sample identifies an optimization target, not a monthly savings estimate.

The local before/after comparison used a production OpenNext build, Chromium at
1440×1000, the same captured 50-row Sends API response, and the same four scroll
positions with timed observation windows. The baseline was main at `a1693910`.

| Observation | Before | After |
| --- | ---: | ---: |
| Automatic address prefetch requests | 1,153 | 0 |
| Automatic transaction prefetch requests | 31 | 0 |
| Automatic block/asset prefetch requests | 42 | 68 |
| Total automatic prefetch requests | 1,226 | 68 |
| Click to address heading after hover | 373 ms | 378 ms |
| Browser exceptions | 0 | 0 |

The chosen address still warmed on hover (two RSC requests in the after run).
The large baseline address count included repeated requests, not 1,153 distinct
addresses. Background scheduling and available connection capacity affect counts
for the unchanged block/asset links. Click timing is one local observation, not a
latency benchmark or production SLO. The measured 94.5% reduction in total automatic
prefetch requests applies to this table exercise, not all Worker traffic or dollars.

Desktop screenshots retained the same layout; mobile at 390×844 had no horizontal
overflow and all 50 View links remained available. Fresh address API reads still
start after navigation, including when the API is unavailable.

## Regression checks

`npm run test:prefetch -w xcp-explorer-web` runs after a production build; development
mode does not exercise Next's automatic prefetch behavior. CI runs it after the
OpenNext build. The four browser cases check no viewport/scroll fan-out, hover,
keyboard Enter, mobile touch/tap, repeated intent, changed destinations after
pagination, browser errors, and fresh address reads after navigation.

Also run `npm run check`, the existing web E2E/accessibility suite, the OpenNext
build, and a Wrangler dry run. Before owner-approved deployment, record the current
Worker version for rollback. After deployment, compare same-duration request/CPU
windows, navigation responses/latency, HTTP errors, D1 usage, and R2 operations.
Separate prefetch requests from actual navigations and retain the longer matched
traffic-window comparison before claiming recurring savings.

Next's supported manual-prefetch API is documented in its
[prefetching guide](https://nextjs.org/docs/app/guides/prefetching).
