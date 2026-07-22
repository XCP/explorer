# Cloudflare

Canonical operating summary for the `xcp.io` Cloudflare account. This file answers what is live, why it exists, how it
was verified, and what remains. The longer [resource-protection plan](cloudflare-resource-protection-plan.md) preserves
the research and decision history; the dated [production baseline](cloudflare-production-baseline-2026-07-21.md)
preserves rollout details.

Last full verification: **2026-07-22 UTC**.

## Current architecture

| Surface | Public ingress | Alternate origins | Resource path |
| --- | --- | --- | --- |
| Web | `https://xcp.io` | `www` edge-redirects to apex; `workers.dev` and previews disabled | `xcp-web` Worker, R2 incremental cache, API service binding |
| API | `https://api.xcp.io/v2/*` | `workers.dev` and previews disabled | `xcp-api` Worker, D1/R2/service bindings |
| Admin | `https://api.xcp.io/admin/*` | No direct public origin | Cloudflare Access Service Auth, then independent Worker Bearer auth |
| Media | `https://cdn.xcp.io/img/*` | `app.xcp.io/img/*` remains a temporary wallet alias; `workers.dev` and previews disabled | `xcp-cdn` Worker, Cache API, R2/KV |

`www.xcp.io` is redirect ingress, not a second site. Its `308` preserves paths and query strings. Web metadata and
maintained internal links use the apex.

## Active protections

- Single Redirects canonicalize `www`; `/favicon.ico` is served directly by the web application's static assets.
- Retired locale namespaces and exact retired API contracts terminate at the edge with `410`.
- Transaction hashes placed in `/address/*` terminate at the edge with `410`.
- The former blanket challenge on valid asset/address/transaction pages is disabled.
- Valid read-only web documents skip Super Bot Fight Mode only. Targeted custom rules, Managed WAF, and rate limiting
  still run. This prevents Cloudflare's automated-traffic classifier from placing a challenge in ordinary navigation.
- A datacenter-ASN Managed Challenge remains, with exact exceptions for verified bots, machine-readable APIs, media,
  health checks, and Access-protected admin traffic.
- Public API and CDN exceptions skip only Super Bot Fight Mode; they do not bypass managed WAF generally.
- Web document sweeps above 600 requests/minute/IP/colo receive plain-text `429` for ten minutes instead of a CAPTCHA.
- The API's separate 600/minute/client/route-family Worker budget remains observe-only pending a longer baseline.
- Cloudflare Managed Ruleset and OWASP Core Ruleset are enabled.
- Workers Logs use 1% sampling and bounded route families; raw entity paths are not emitted by application telemetry.

## Administrative boundary

The `XCP API Admin` Access application covers `api.xcp.io/admin/*`. Its `xcp-api-admin-automation` service token expires
**2027-07-22**. Schedule renewal warning before 2027-07-15.

Admin requests require both:

1. `CF-Access-Client-Id` and `CF-Access-Client-Secret` for Cloudflare Access.
2. `Authorization: Bearer ADMIN_TOKEN` for the Worker.

The one-time Access secret and application token are stored only in ignored local environment files. Maintained operator
scripts load Access credentials from environment variables or `apps/api/.dev.vars` and default to `api.xcp.io`.

## Cache policy

| Response | Browser policy | Shared Worker cache | Reason |
| --- | --- | --- | --- |
| Stored media | One year, immutable | Canonical Cache API key shared by CDN aliases | Content-address-like stable media |
| Missing decorative logo | 5 minutes | 1 hour | Avoid repeated R2/KV misses; logos change infrequently |
| Missing asset-art placeholder | 1 minute, private | 5 minutes | Cheap repeated rendering with a strict bound on later ingestion visibility |
| Transient-error placeholder | `no-store` | None | Retry immediately after R2/KV/runtime recovery |

The Worker-created canonical cache key cannot be globally purged by URL. `cache.delete()` affects only the invoking data
center, so bounded negative TTLs are the reliable invalidation mechanism. Canonical and legacy media hosts share the
same Cache API object.

## Full verification scan

The 2026-07-22 scan queried live Rulesets and Access APIs, then performed external HTTP canaries.

### Configuration inventory

| Component | Live result |
| --- | --- |
| Dynamic Redirect ruleset | Version 4, one `www` canonicalization rule |
| Custom WAF ruleset | Version 47, nine rules |
| Rate-limit ruleset | Version 5, one rule |
| Managed WAF entry point | Version 3, Cloudflare + OWASP rulesets |
| Cache ruleset | Version 4, one rule |
| Access | One application, one service token, one attached policy |
| Web Worker | `70fd587c-425d-46c4-8ef3-3b97b8086892` |
| API Worker | `d11958fd-d5cf-411f-92e3-70aba4f0aaba` |
| CDN Worker | `dd1ed650-26f7-424d-bf1f-df39522508c2` |

### Contract canaries

| Canary | Expected | Observed |
| --- | ---: | ---: |
| `www` path + query | Apex redirect | `308`, path/query preserved |
| Static apex icon | Available | `200` |
| Retired locale | Edge tombstone | `410` |
| Transaction hash in address route | Edge tombstone | `410` |
| Retired web and legacy price APIs | Edge tombstone | `410` |
| Public API status | Available JSON | `200` |
| API `workers.dev` | Closed | `404` |
| Web `workers.dev` | Closed | `404` |
| CDN health | Available | `200` |
| Admin without Access | Rejected by Access | HTML `401` |
| Admin with Access only | Rejected by Worker | JSON `401` |
| Admin with both credentials | Real read-only handler | JSON `200` |
| Missing logo, canonical then alias | Shared negative cache | `404` MISS then HIT, intended TTLs |
| Missing artwork, canonical then alias | Shared placeholder cache | `200` MISS then HIT, private 60-second client TTL |

API deployment also passed all 33 production contract tests; CDN passed all 21 serving/ingestion tests.

### Production traffic snapshot

In the scan's preceding hour, Cloudflare recorded 1,686 `xcp.io` `200`s, 481 public API `200`s, 357 CDN `200`s, and
289 `www` `308`s. Custom protections recorded 811 exact Skip decisions and 179 custom edge blocks. These demonstrate
that the canonical routes and edge rules are receiving real traffic, not merely existing as dormant configuration.

Zone GraphQL also reports `204` and `504` groups produced by Worker Cache API and service-binding/subrequest activity.
Do not label those aggregates as public failures without correlating Worker logs and an external contract probe.

### Navigation performance incident

On 2026-07-22, real navigation to `PEPETHEFROG` and `A142641970830520746` appeared to stall for about 15 seconds.
The asset-detail APIs themselves responded in roughly 80-300 ms. Security Events and response headers proved that
Cloudflare rule `874a3e315c344b1281ad4f00046aab6f` was issuing a Managed Challenge before the web Worker ran.

The preceding 24-hour sampled event set showed why IP, country, and user-agent blocks are unsuitable here: that rule
challenged 1,674 requests from 1,334 IPs, 470 ASNs, and 103 countries; 1,544 requests had browser-shaped user agents,
and the busiest IP contributed only 56 events. This is distributed, low-rate automation mixed with human-looking
traffic.

The response is route-cost layering:

1. Terminate impossible and retired paths before Worker execution.
2. Keep Managed WAF and the explicit datacenter policy for high-confidence risk.
3. Let valid web `GET`/`HEAD` documents bypass only Super Bot Fight Mode.
4. Use the existing 600-page/minute/IP/colo ceiling for sustained sweeps, returning `429` without a CAPTCHA.
5. Make valid reads inexpensive through bounded application caching, parallel server reads, and indexed D1 queries.

After the SBFM-only document exception went live, both incident pages returned `200`; repeated external probes completed
in about 0.15-0.84 seconds. A live production trace also observed an unrelated asset page completing in 473 ms. These
measurements establish that the reported 15-second delay was primarily challenge latency, not an asset-detail query
regression. Continue measuring query and rendering tails independently; this finding does not excuse slow application
paths elsewhere.

## 24-48 hour success review

Success does **not** require total bot traffic to decline. Valid documents now bypass SBFM, so successful `200` traffic
may rise as requests that previously stopped at a challenge reach the application. The objective is fewer human
interruptions and lower tail latency without a material increase in compute cost, errors, or saturation.

At the next review, compare a complete 24-hour window with the pre-change baseline:

| Signal | Expected outcome |
| --- | --- |
| Challenges on valid web documents | Approximately zero for ordinary `GET`/`HEAD` navigation |
| Asset-page Worker wall time | Generally below 1 second; initial p95 target below about 1.5 seconds; no recurring 10-15 second stalls |
| Public asset API latency | Low hundreds of milliseconds, without elevated `5xx` or service-binding fallback timeouts |
| Browser experience | Normal and rapid multi-page browsing proceeds without challenges or throttling; record LCP p50/p95/p99 when RUM is available |
| Impossible and retired routes | Continue terminating at the edge with the documented `403`/`410`, without Worker execution |
| Sustained high-rate sweeps | Cross the 600 requests/minute/IP/colo ceiling and receive cheap `429`, not a CAPTCHA |
| Worker, D1, R2, and CPU use | Stable enough that allowing valid documents does not create a material cost or saturation increase |
| Error rate | No material increase in public `5xx`, Worker exceptions, or dependency timeouts |

Interpret the result using these rules:

1. If navigation is fast and resource use is stable, retain the policy even if bot requests or document `200`s rise.
2. If navigation improves but resource cost rises materially, improve caching or add route-cost-specific budgets before
   restoring challenges.
3. If valid documents are still challenged, identify and narrow the remaining Cloudflare service or rule.
4. If p95/p99 remains slow without challenges, investigate application queries, service-binding fallback, cache misses,
   and frontend waterfalls separately.
5. Treat raw bot-request counts as context, not the primary success metric. Distributed low-rate automation may remain
   visible even when the protection strategy is working.

## Remaining work

- Observe cache, WAF, rate, and Worker metrics for seven days before tightening public API budgets.
- Measure valid-document p50/p95/p99 Worker wall time and browser LCP, and alert on challenge responses reaching
  document navigation. Reconsider the SBFM exception only if route-cost evidence exceeds the site's compute budget.
- Repair `/admin/status`, which currently authenticates successfully and then returns application JSON `500`; use
  `/admin/backfills` or `/admin/bitcoin-fees?limit=1` as read-only boundary canaries meanwhile.
- Measure wallet 0.5.1 adoption before removing the temporary `app.xcp.io/img/*` and remaining legacy search/swap paths.
- Add new route-shape rejection only when logs show a high-cost mathematically impossible family. Do not reject unusual
  Counterparty multisig or UTXO identities merely because they are not ordinary Bitcoin addresses.
- Renew or rotate the Access service token before expiry and rerun the dual-auth matrix afterward.

## Rollback rules

- Never replace a false positive with a blanket CAPTCHA. Disable or narrow the exact responsible rule.
- If admin Access fails, preserve Worker Bearer authentication. Re-enable API `workers.dev` only for an urgent, bounded
  recovery window, then disable it again.
- If web routing fails, `workers.dev` may be temporarily re-enabled as a diagnostic origin, not a permanent hostname.
- If CDN negative caching hides newly found media beyond its documented bound, disable only placeholder caching; retain
  immutable caching for real stored objects.
- Keep Cloudflare and application authentication credentials out of Git, logs, URLs, and this document.
