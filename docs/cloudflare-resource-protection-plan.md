# Cloudflare resource-protection plan

Status: active staged rollout, reviewed against production configuration and traffic on 2026-07-21. Follow the staged
rollout and rollback gates below.

## Implementation status

Layers 1–2 deployed and verified on 2026-07-21:

- browser API base changed from `xcp-api.me-bbe.workers.dev` to zone-protected `https://api.xcp.io`;
- exact public `api.xcp.io` `/v2` GET/HEAD/OPTIONS traffic skips only SBFM, while managed WAF and future rate controls
  remain applicable;
- retired locale namespaces return a WAF-generated `410 Gone` before the web Worker;
- API and web Workers have 1% Workers Logs head sampling enabled;
- API sampled logs use bounded route families and record duration plus edge/D1 cache outcomes without entity IDs;
- CDN exemption is limited to GET/HEAD image and image-transform paths and skips only SBFM;
- exact public JSON reads and CDN image paths are also excluded from the later datacenter challenge;
- the read-only legacy `app.xcp.io/api/v1/*` forwarding surface has the same machine-client treatment; other
  unsupported legacy contracts return application `404` rather than a Cloudflare HTML challenge;
- wallet extension 0.5.1 migrated price, search, market, and media traffic to canonical `api.xcp.io/v2` and
  `cdn.xcp.io`; the obsolete XCP price and USD-prices contracts now return edge-generated `410`, while legacy
  search/swap remain during the installed-client transition;
- the blanket detail-page challenge is disabled; malformed-address, datacenter, managed-WAF, and interim sweep controls
  remain;
- active operator scripts support optional Access service-token headers; their defaults remain on `workers.dev` until
  Access exists so unattended maintenance is not broken;
- existing API live contract suite passed 33/33 after deployment;
- document rate threshold, public API `workers.dev` availability, and admin Access remain pending their dependency stages.

The transitional API `workers.dev` origin remains reachable for rollback and operator jobs. Browser traffic no longer
depends on it, but admin protection is incomplete until Access is available, operator defaults migrate, and the origin is
disabled or gains equivalent Worker-native service authentication. The current Cloudflare automation token receives
`403` from the Access API, so that boundary cannot be created safely through tonight's automation credentials.

## Objective

Protect Worker CPU, D1 reads, upstream subrequests, and bandwidth from automated abuse without putting routine explorer
navigation behind repeated challenges. The governing rule is **protect expensive behavior, not ordinary routes**.

The desired user experience is:

- a person can browse assets, addresses, transactions, collections, and tables without a challenge;
- a verified search crawler can index canonical public pages from cached data;
- documented integrations can use the public API within an explicit budget;
- authenticated maintenance jobs can run without being mistaken for attacks;
- impossible, retired, and scanner-generated paths stop at Cloudflare before a Worker executes;
- clients exceeding a plainly non-human rate receive `429`/temporary blocking, not an endless CAPTCHA loop.

## Evidence used

This plan reconciles three evidence sources:

1. Production Cloudflare configuration and GraphQL analytics for the `xcp.io` zone, queried on 2026-07-21.
2. Repository behavior in `apps/web`, `apps/api`, and their Wrangler configuration.
3. Current Cloudflare documentation for Pro, Workers Paid, WAF, caching, Access, and bot controls.

Official references:

- [Bot products and plan boundary](https://developers.cloudflare.com/bots/)
- [Super Bot Fight Mode custom exceptions](https://developers.cloudflare.com/bots/additional-configurations/custom-rules/)
- [Security-product ordering and Skip behavior](https://developers.cloudflare.com/waf/feature-interoperability/)
- [WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Rate-limit parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/)
- [Workers and Cache Rules precedence](https://developers.cloudflare.com/cache/interaction-cloudflare-products/workers-cache-rules/)
- [Challenge Passage](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/challenge-passage/)
- [Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Workers Logs and sampling](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

## What production traffic actually says

The dashboard's one-day overview reported approximately 12,460 unique visitors, 114,120 requests, 5 GB served, and a
6.28% cache rate. These headline values are not a human-audience count. Detailed groups mix:

- genuine browser traffic;
- local operator jobs, recognizable by their authenticated admin paths and machine user agents;
- Worker-to-Worker and Worker-to-upstream subrequests, which appear under Cloudflare or upstream infrastructure ASNs;
- verified and unverified crawlers;
- generic vulnerability probes and legacy-URL sweeps.

Consequently, neither ASN volume nor country volume is a safe block criterion by itself. In particular, large Verizon,
Cloudflare, and OVH totals included traffic we could attribute to our own workstation, Workers, and upstream services.

### High-confidence automated behavior

- Retired locale paths are still swept. In the available seven-day detail window, `/en/*` had at least 1,766 grouped
  requests, primarily repeated `/en/asset/*` requests from hosted OVH infrastructure with no referrer. Individual
  Bitcorn asset URLs were requested roughly 30-36 times each. `/es/*` included generic `/es/login` probing.
- Four transaction-hash-shaped values were reported under `/address/*`. They are absent from the production
  `address_dictionary`, and the repository does not generate those links. Recent zone events for those exact paths were
  our own verification requests, so no outside IP should be banned on that evidence.
- One hosted client repeatedly requested the retired `/api/asset/xcp` surface around 1,181 times in a day. This is a
  credible automation signal but could be a legacy integration; challenge or rate-limit it before considering a
  permanent address block.
- Port variants, login paths, and generic API paths appear in low-volume scanner traffic. They should be rejected by
  route/host shape, not maintained as an ever-growing IP list.

### Reliability traffic that is not solved by bot blocking

The aggregate response groups contained substantial `504` and `204` traffic, much of it associated with Worker and
upstream activity. Bot controls do not repair an unhealthy upstream or an overly frequent maintenance loop. Keep
reliability analysis separate from hostile-client analysis.

## Source-grounded architecture

### Web Worker

- `apps/web/wrangler.toml` routes `xcp.io/*` and `www.xcp.io/*` to the OpenNext Worker and retains the
  `workers.dev` origin for deployment verification.
- Browser-side API calls now use `NEXT_PUBLIC_API_BASE=https://api.xcp.io`. Server-side calls continue through the
  service binding. The API Worker's `/admin/*` surface remains reachable on `workers.dev` (with Bearer authentication,
  but after the Worker starts), so ops migration and origin protection remain architectural prerequisites.
- The web Worker uses an R2 incremental-cache binding.
- Server-side API reads use an `API_WORKER` service binding, avoiding a public-network round trip.
- Dynamic detail fetches already use revalidation: transactions 5 seconds, addresses/assets/blocks 30 seconds, UTXOs
  60 seconds, tags 300 seconds, and slow-changing year/rating views up to one hour.
- `apps/web/src/middleware.ts` returns a cacheable `410` for retired locale prefixes and transaction hashes placed in
  the address namespace. This protects `workers.dev`, but the locale response still invokes the web Worker on zone
  traffic because production currently has no corresponding edge rule. The source comment claiming a zone cache rule
  already holds these responses at the edge is inaccurate until the proposed edge tombstone is deployed.

### API Worker

- Public read routes live principally under `/v2/*` and are GET-only.
- `apps/api/src/read/router.ts` already uses `caches.default` for successful cacheable reads, including service-binding
  calls that bypass ordinary CDN caching.
- `apps/api/src/read/respond.ts` adds a second, persistent D1 stale-while-revalidate layer for selected low-cardinality
  aggregates. Do not add a blanket third cache without measuring `x-cache`, `x-d1-cache`, and endpoint freshness.
- Entity endpoints are high-cardinality but normally cache successful results for a short endpoint-specific TTL.
- Unknown entities commonly return 404 and are not admitted to the successful-response Cache API. Structurally invalid
  identifiers should therefore be rejected before route/database work; bounded negative caching may be useful for
  well-formed-but-unknown entities after measuring abuse and stale-negative risk.
- Admin routes are all under `/admin/*` and use a shared constant-time Bearer-token middleware. Authentication is sound
  at the application layer, but an unauthenticated request still invokes the Worker before receiving 401.

## Current Cloudflare posture

Production currently has:

- Pro plan and Workers Paid;
- Super Bot Fight Mode: definitely automated traffic receives Managed Challenge; verified bots are allowed;
- AI bot protection: block;
- Browser Integrity Check: on;
- Challenge Passage: 30 minutes, within Cloudflare's recommended 15-45 minute range;
- managed Cloudflare and OWASP rulesets;
- CDN images eligible for a one-year edge TTL and one-day browser TTL;
- one sweep rate rule at 240 documents/minute/IP/colo, using Managed Challenge;
- a blanket Managed Challenge for `/address/*`, `/asset/*`, and `/tx/*` for non-verified bots;
- a narrow SBFM-only Skip for canonical public API reads, plus a still-broad Skip for all of `cdn.xcp.io`;
- a WAF custom `410` for all retired locale namespaces;
- a hard block for impossible transaction-hash-shaped address routes, ordered before the blanket page challenge.

### Findings

1. The blanket detail-page challenge is route-based, not behavior-based. It is the principal source of avoidable human
   friction and should be removed after replacement controls are ready.
2. The former path-wide API Skip bypassed rate limiting, managed WAF, and SBFM. Layer 1 replaced it with an exact
   `api.xcp.io` public-read exception that skips only SBFM.
3. Permissive CDN image delivery is intentional and justified: a single legitimate page may request hundreds of images,
   objects have a one-year edge TTL, and egress is not the constrained resource. The problem is scope, not
   permissiveness—the current whole-host Skip also covers `/admin/*` and any future non-image path on `cdn.xcp.io`.
4. The operator-IP exception is brittle because residential prefixes change. Machine identity is more defensible than
   continually expanding an IP allowlist.
5. The 6.28% zone-level cache figure is not enough to diagnose application cache effectiveness because it mixes many
   hosts and Worker subrequests. Endpoint headers and Worker analytics are required.
6. Zone rules cannot protect the configured public `workers.dev` API origin. Claims about API WAF, SBFM, Access, or
   zone rate limiting are false until the canonical API path is changed or equivalent controls run inside the Worker.

## Target policy by route family

| Surface                                                            | Normal treatment                                                 | Abuse treatment                                | Cache strategy                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Public list pages                                                  | No challenge                                                     | Global document ceiling                        | Existing static/ISR behavior; measure misses         |
| `/address/*`, `/asset/*`, `/tx/*`, `/utxo/*`, `/block/*`, `/tag/*` | No blanket challenge; validate shape                             | Document ceiling plus Worker API budget        | Existing Next revalidation and API Cache API         |
| Public `/v2/*` reads                                               | WAF; narrowly skip SBFM for exact public API GETs                | Route-family Worker rate limits                | Existing Cache API/D1 SWR; tune by endpoint evidence |
| `/admin/*`                                                         | Access service identity plus Bearer defense-in-depth             | Deny before Worker                             | Never public-cache                                   |
| Canonical CDN image GET/HEAD                                       | Deliberately permissive; narrowly skip SBFM/rate controls        | Automatic DDoS; reject invalid methods/paths   | Keep one-year edge TTL                               |
| Telegram webhook                                                   | Exact route, webhook secret; narrowly skip SBFM only if required | Endpoint-specific rate limit                   | Not cacheable                                        |
| Retired locale prefixes                                            | WAF custom `410 Gone`                                            | Count continued sweeps toward document ceiling | Edge decision; no Worker execution                   |
| Structurally impossible paths                                      | Edge block/`410`                                                 | Count toward sweep behavior                    | Long negative TTL where safe                         |
| Verified search bots                                               | Allow canonical pages                                            | Revisit only with evidence of category abuse   | Serve cached data; honor robots/canonicals           |

## Proposed rules and implementation

Expressions below are designs to validate in Cloudflare Trace/Security Analytics before deployment. Cloudflare Pro does
not support regex in custom rules, so expressions deliberately use exact comparisons, sets, prefix tests, and lengths.

### 1. Edge tombstone for retired locales

Match the canonical web hosts and any retired locale root or prefix:

```text
(http.host in {"xcp.io" "www.xcp.io"}) and
(
  http.request.uri.path in {"/en" "/es" "/de" "/fr" "/it" "/ja" "/ko" "/nl" "/pl" "/pt" "/ru" "/tr" "/uk" "/zh" "/cn" "/jp"}
  or starts_with(http.request.uri.path, "/en/")
  or starts_with(http.request.uri.path, "/es/")
  ...one prefix clause for each retired locale...
)
```

Action: WAF custom Block response with status `410 Gone` and a small plain-text body. Cloudflare's Pro WAF custom
response supports a 400-499 status, content type, and body; it does not expose arbitrary response headers. Do not claim
`Cache-Control` or `X-Robots-Tag` on this WAF response unless a Trace-tested Snippet or other response product is added.
No response cache is necessary to protect application resources because the WAF decision terminates before the Worker.
Do not challenge. A retired namespace has no human exception to solve.

Keep the existing middleware tombstone for direct `workers.dev` traffic and defense-in-depth.

### 2. Structural route rejection

Maintain a small allow-specification for dynamic identifiers:

- `/tx/:hash`: one segment, 64 hexadecimal characters;
- `/address/:address`: an address/location form demonstrated by production Counterparty data and tests;
- `/block/:height`: decimal integer within a defensible length/range;
- `/utxo/:txid:vout`: 64-hex transaction ID and bounded non-negative output index;
- `/asset/:asset`: named, numeric, or longname syntax accepted by Counterparty;
- `/tag/:tag`: one bounded slug segment.

Inventory Counterparty multisig/UTXO-location forms and accepted asset longnames before hardening validators; generic
Bitcoin-address validation alone is insufficient. Cloudflare Pro expressions should catch only mathematically impossible
cases. Complete semantic validation belongs in lightweight Worker middleware shared with search/navigation validation.
Return `400` for malformed current routes and `410` only for intentionally retired namespaces. A middleware
`Cache-Control` header alone does not guarantee Cloudflare will cache the error; use WAF termination or an explicit Cache
API/Trace-tested rule if negative caching is measured and required. Do not label well-formed unknown entities malformed.

### 3. Remove the blanket detail challenge

Disable the custom Managed Challenge covering every `/address/*`, `/asset/*`, and `/tx/*` request once the tombstone,
shape checks, and replacement rate ceiling are active. Retain:

- Super Bot Fight Mode `Definitely automated -> Managed Challenge`;
- verified bots allowed;
- AI bots blocked;
- managed WAF rules.

No Turnstile widget is warranted for ordinary read-only exploration. If a future write/login form is introduced, protect
that action rather than the entire explorer.

### 4. Replace the broad Skip rules

Delete the path-wide API Skip. Once `api.xcp.io` is canonical, replace it with a narrow rule matching that hostname and
the exact public read namespace. Skip only SBFM for public API GETs: JSON, CLI, and mobile clients cannot solve a browser
challenge. Retain managed WAF and enforce Worker route-family budgets. Administrative, verification, extension, and
unknown API paths must not inherit the public-read exception.

Replace the CDN-wide Skip with an intentionally permissive, path-and-method-scoped exception for canonical image
`GET`/`HEAD` requests. It is reasonable for that exception to skip SBFM and general rate limiting: normal page fan-out can
be hundreds of images, the objects are cheap edge-cache hits, and per-IP image ceilings would punish real browsers and
shared networks. Keep Super Bot Fight Mode static-resource protection off unless the cost model changes. Do not challenge
image loads.

The exception must not include `/admin/*`, arbitrary methods, or future non-image namespaces. Those remain subject to
normal WAF/authentication policy. Cloudflare's automatic DDoS protection remains in force without an application rate
limit.

Keep Telegram exceptions exact. Prefer a secret webhook path/header and skip only the product proven to interfere.

### 5. Protect admin work before Worker execution

Create a Cloudflare Access application for administrative paths and use a service token for scripts. The Worker Bearer
token remains mandatory as defense-in-depth. Migration steps:

1. Inventory every local/remote caller of `/admin/*`, including CDN backfill/census tools.
2. Resolve the API `workers.dev` exposure: disable it, separate public/admin Workers, or add equivalent Worker-side
   service-token enforcement. Protecting only `api.xcp.io/admin/*` leaves a bypass.
3. Add standard `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers without logging them. Do not configure Access
   to reuse `Authorization`; the application already consumes `Authorization: Bearer ADMIN_TOKEN`.
4. Canary a dedicated harmless Access-protected status path with the service token before moving all admin routes.
5. Confirm scheduled and service-binding jobs do not traverse the public Access application.
6. Enforce Access on every public route to `/admin/*` and remove reliance on changing residential IP prefixes.
7. Keep an emergency recovery procedure using the Cloudflare dashboard and rotated credentials.

### 6. Replace challenge-heavy sweeping with a non-interactive ceiling

Cloudflare Pro's zone rate limiter is materially constrained: only two rules, IP-based characteristics, counters
necessarily scoped per Cloudflare colo, and no reliable HTTP-method/header/cache classification available at this plan
level. Do not describe a Pro rule as counting only HTML documents or uncached requests. Reserve the two zone rules for
the broadest resource boundaries and put nuanced route classification in Worker Rate Limiting.

Initial zone rule, subject to a seven-day canary:

- scope: canonical web hosts and real page namespaces, expressed using only Pro-supported host/path fields;
- exclude `/_next/*`, obvious static paths, public API/CDN hosts, operator service identities, and verified bots where the
  Pro expression surface permits it;
- characteristic: client IP, with the required implicit/API `cf.colo.id` locality;
- initial threshold: derive from the observed p99 per-IP path-request rate after tagging operator traffic and testing
  Next Link prefetch, RSC, multi-tab browsing, and carrier NAT; use 120 path requests/minute only as a canary hypothesis;
- action: `429`/Block for ten minutes;

A request is not necessarily one complete navigation: Next prefetch/RSC and multi-tab use can add requests. A block above
an empirically non-human ceiling is preferable to repeated challenge pages. If carrier NAT causes false positives, raise
the threshold or move finer policy into a Worker/API identity; do not broadly allow the ASN.

### 7. Add Worker route-family budgets

The Workers Rate Limiting binding is local and eventually consistent, appropriate for abuse containment rather than
billing-grade accounting. Placement matters: the current API middleware checks `caches.default` before handlers. To
protect expensive work without charging cheap hits, classify a bounded route family, check the edge cache, and increment
the expensive-family limiter only on cache MISS before `next()` invokes D1/upstreams. Classify malformed attempts before
route handlers. A well-formed unknown entity cannot be known without its first lookup; controlling repeats requires an
explicit negative cache or post-response accounting.

Initial anonymous canary budgets:

| Family                        |         Initial ceiling | Key                           |
| ----------------------------- | ----------------------: | ----------------------------- |
| ordinary cache misses         |              300/minute | anonymous IP + bounded family |
| entity/history/graph misses   |              120/minute | anonymous IP + bounded family |
| malformed attempts            |               30/minute | anonymous IP + invalid family |
| future authenticated bulk API | documented higher quota | new API-key identity + family |

Anonymous IP keys are imperfect behind carrier NAT, and Cloudflare advises preferring stable user identities where they
exist. No public API-key identity scheme exists in source today; the authenticated row above is a separate feature, not
binding configuration. Begin with deliberately high anonymous ceilings. Use bounded constant family names—never raw
paths/queries—as limiter keys. Return JSON `429` with `Retry-After` and emit an Analytics Engine event for every rejection.

### 8. Cache based on measured application work

Do not deploy a blind zone-wide Cache Everything rule. The source already has:

- Next revalidation/R2 incremental caching;
- API per-colo Cache API;
- persistent D1 SWR for selected aggregates;
- one-year CDN image caching.

Instead, collect `x-cache`, `x-d1-cache`, status, route family, and `Server-Timing` for a week. Then:

- increase TTLs for immutable historical blocks/confirmed transactions;
- preserve short freshness for mempool and newly confirming transactions;
- tune asset/address detail TTLs only when miss cost is demonstrated;
- consider a bounded negative cache for well-formed unknown immutable hashes;
- keep malformed identifiers out of D1 entirely;
- use Cloudflare Trace before relying on a Cache Rule, because Worker settings take precedence.

### 9. Observability and review loop

Enable Workers Logs with a low head-sampling rate (for example 1%) and emit unsampled Analytics Engine counters for
Worker security decisions. A 1% sample cannot validate rare false-positive blocks, and WAF/SBFM actions happen before the
Worker, so use Cloudflare Security Events/GraphQL for edge decisions. Available detailed retention is seven days. Do not
log credentials, full authorization headers, or unnecessary full IP addresses in application logs.

Required dimensions/counters:

- host and normalized route family;
- action: allow, edge tombstone, malformed, cache hit/miss, rate limited, admin denied;
- response status and approximate response bytes;
- Worker duration/subrequest/D1 indicators available from Cloudflare;
- verified-bot category where available;
- service identity versus anonymous traffic;
- deployment/config version.
- Cloudflare rule/config ID for edge analytics and bounded route-family ID for Worker analytics.

Build a weekly report with:

- requests and estimated Worker executions avoided by tombstones;
- cache hit rate by route family, not whole-zone headline;
- 404/410/429 volume and top normalized invalid families;
- unique clients crossing 50%, 80%, and 100% of each limit;
- challenge solve/failure rates;
- p95/p99 legitimate-client rates;
- admin authentication failures;
- top upstream 504 families separately from bot traffic.

## Endpoint-specific treatment

These surfaces should not inherit a single generic threshold.

| Surface                                                   | Evidence/cost                                                                                                                   | Recommended treatment                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.xcp.io/api/v1/usd-prices`                            | Roughly 1,279 combined 404/504 responses in the sampled day across several access networks                                      | Decide whether old clients deserve a cached compatibility response from `/v2/price`; otherwise edge `410`. Do not keep producing a dynamic error.                    |
| `app.xcp.io/api/v1/asset/XCP`                             | Roughly 683 combined 404/504 responses/day                                                                                      | Same explicit compatibility-or-retirement decision; do not challenge JSON clients.                                                                                   |
| `xcp.io/api/asset/xcp`                                    | 604 HTML 404s produced about 17 MB in one sampled group; broader daily traffic was around 1,181 requests from one hosted client | Treat as a legacy API contract. Return a small edge tombstone or a documented cached compatibility response. Rate-limit the client only after the contract decision. |
| `/admin/backfill`, `/admin/census`, all `/admin/*`        | Thousands of legitimate machine requests and potentially heavy writes/scans                                                     | Access service identity before Worker plus existing Bearer token. Separate maintenance quotas/timeouts; never include in public limits.                              |
| `/v2/graph/address/*`, `/v2/graph/asset/*`                | Neighborhood/holder graph queries can expand substantially even with a 120-second cache                                         | Expensive-family cache-miss budget; cap returned nodes/edges; keep family-specific metrics.                                                                          |
| `/v2/transactions/:hash/bitcoin`                          | May call Electrs/external Bitcoin data; confirmed results are immutable and already receive 300-second API caching              | Cache confirmed results much longer after correctness review; use a tighter cache-miss budget for pending/unknown hashes.                                            |
| `/v2/mempool*` and pending transaction views              | Intentionally polled and freshness-sensitive                                                                                    | Separate generous polling budget, short cache/deduplication, and client backoff. Do not apply historical-detail TTLs.                                                |
| `/v2/assets/:asset/enhanced`, `/market`                   | Fetches external metadata/market services and can fail independently of D1                                                      | Circuit breaker, stale success, bounded timeout, and external-family cache-miss budget.                                                                              |
| Asset/address summary and history tabs                    | High-cardinality D1 reads; a single page can fan out into several tab requests                                                  | Preserve per-colo cache; limit only cache misses by entity family; cap pagination.                                                                                   |
| `/v2/price`, reputation tiers, years, collection profiles | Appeared among internal 504-like cache/subrequest groups but are already backed by persistent `cached()` entries                | Verify with Workers Logs before changing. Prefer repairing cache misses/upstream behavior over client blocking.                                                      |
| Cache API `PUT`s                                          | Large 204 population consists substantially of `caches.default.put()` from API middleware, not hostile public writes            | Track as internal cache churn. Do not write WAF rules against apparent public `PUT /v2/*` until Workers traces confirm provenance.                                   |
| CDN image GET/HEAD                                        | Hundreds of legitimate images per page; one-year edge TTL; egress is not the concern                                            | Remain permissive and outside ordinary page/API budgets. Measure cache misses, not request fan-out.                                                                  |
| Repeated missing CDN logo paths                           | Dozens of 404s per missing logo slug                                                                                            | Add a durable fallback/negative cache so repeated missing art is cheap; do not challenge the browser.                                                                |
| `/favicon.ico`                                            | More than 200 sampled 404s and over 1 MB of avoidable error bodies                                                              | Ship/cache a real favicon or an edge-static empty response.                                                                                                          |
| `.env`, framework admin/login, port-probe paths           | Repeated generic vulnerability inventory with no valid product use                                                              | Hard block/tombstone at WAF by high-confidence path families; count toward broad sweep behavior.                                                                     |

Cloudflare's aggregate `504` and `204` groups include Worker Cache API and service-binding activity. They are not direct
proof that end users received those statuses. Workers Logs/traces must attribute client response versus internal
subrequest before an endpoint is classified unhealthy or abusive.

The post-Layer-1 live contract run also supplied one cold/post-deploy latency sample. It is not a steady-state benchmark,
but it prioritizes observation: `/v2/emblem/assets` took about 3.5 seconds, `/v2/emblem/stats` and
`/v2/collections/candidates` about 2.3 seconds, native `/v2/assets/XCP` about 1.4 seconds, and `/v2/assets` about 1.2
seconds. Their cache-miss rates and D1/upstream timing should be measured before assigning family-specific budgets.

## Rollout sequence

### Phase A: establish observability and close the API-origin ambiguity

1. Export/version current rules and add structured Security Events/Worker/cache telemetry.
2. Measure browser calls to `workers.dev` versus `api.xcp.io` and service-binding calls.
3. Choose and test the canonical API architecture: zone-protected `api.xcp.io`, protected/disabled API `workers.dev`,
   and internal service binding for server components.
4. Preserve an exact public `/v2` SBFM exception so non-browser clients are not challenged.

Success: every public API origin has an explicit protection model and metrics distinguish client responses from internal
cache/subrequests. Rollback: restore the browser API base while retaining Worker-native controls.

### Phase B: eliminate known waste and protect operations

1. Deploy the locale WAF custom `410` and verify `/en/asset/...` never invokes the web Worker.
2. Add only mathematically safe edge shape checks; add source validators/tests for the remainder.
3. Decide compatibility versus `410` for the three high-volume legacy API surfaces.
4. Inventory callers depending on API/CDN/Telegram skips and narrow them while preserving exact image and public API
   SBFM exceptions.
5. Add and canary Access service credentials, then enforce Access across every public admin origin.
6. Correct the middleware comment after the edge tombstone is truly live.

Success: retired/invalid requests stop before application work, maintenance continues, and no public namespace bypasses
all security phases. Rollback the exact route/service rule that failed rather than restoring a hostname-wide bypass.

### Phase C: remove routine challenges

1. Deploy Worker budgets in observe/very-high canary form and measure real cache-miss/client distributions.
2. Deploy the Pro-compatible non-interactive page-namespace ceiling at an empirically conservative threshold.
3. Once locale/shape/SBFM/ceiling controls are proven, promptly disable the blanket detail-page challenge; do not wait
   for unrelated Access or cache optimization work.
4. Monitor challenges, 429s, support reports, and legitimate-client percentiles for seven days.

Success: normal detail browsing produces no challenge, while sustained page sweeps cross the ceiling. Rollback: raise or
disable the ceiling; do not immediately restore blanket challenges unless there is an active resource incident.

### Phase D: endpoint budgets and cache tuning

1. Enforce malformed and expensive cache-miss family budgets first.
2. Add compatibility/tombstone/fallback behavior for measured legacy and missing-resource endpoints.
3. Design API identities only if legitimate bulk demand exists.
4. Tune TTLs from measured miss cost and freshness requirements.

Success: abusive API traffic returns cheap 429s before D1/upstream work, and cache misses decline without stale-data
incidents. Rollback each family independently.

## Validation checklist

Before each production change:

- export/version the current Cloudflare ruleset;
- run Cloudflare Trace against positive and negative examples;
- test apex, `www`, `workers.dev`, API service binding, CDN, Telegram, and admin callers;
- confirm rule ordering, because an earlier Skip or Challenge can prevent the intended rule from executing;
- test a browser without clearance cookies and one with an existing `cf_clearance` cookie;
- verify Google/Bing canonical crawling remains allowed;
- verify status, cache headers, and Worker invocation behavior;
- define the exact metric and threshold that triggers rollback.

After each change:

- inspect Security Events for the actual rule ID/action, not merely the HTTP status;
- compare Worker invocations, D1 reads, 404/410/429 counts, cache-hit headers, and user complaints;
- wait through an appropriate observation window before tightening the next layer.

## Decisions and non-decisions

Recommended now:

- stay on Pro; Enterprise bot scoring is not justified by current scale/evidence;
- remove routine route challenges after replacement controls;
- move retired routes to edge `410`;
- use service identity for admin automation;
- replace broad skips with exact, product-scoped exceptions;
- use high, behavior-based ceilings and cheap 429s;
- tune cache from application headers and miss cost.

Not recommended:

- country-wide, residential-ASN, Verizon, Cloudflare, or OVH blanket blocks;
- permanent IP bans based on a single malformed request;
- CAPTCHA/Turnstile on read-only navigation;
- a giant hand-maintained scanner-IP list;
- blind Cache Everything across personalized or freshness-sensitive routes;
- interpreting zone-level unique visitors or cache percentage as application-user or API-cache truth.

## Implementation task list

- [x] Export current custom, managed, rate-limit, cache, bot, and zone settings to a sanitized versioned artifact.
- [ ] Resolve the browser `workers.dev` API origin versus zone-protected `api.xcp.io`; protect or disable every public
      admin origin while retaining service-binding traffic.
- [x] Add and Trace-test the locale WAF custom-response tombstone.
- [x] Verify Worker invocation avoidance for retired locale requests.
- [ ] Build shared route-shape validators and tests for web/API namespaces.
- [x] Enable 1% Workers Logs head sampling on API and web Workers; structured bounded API decisions are live.
- [x] Inventory all callers relying on `/api/`, CDN, Telegram, and operator Skip behavior; identify the exact canonical
      CDN image prefixes and methods.
- [ ] Create Cloudflare Access application/service token for `/admin/*` callers without colliding with app Bearer auth.
- [x] Narrow broad API/CDN Skip rules while preserving exact public-API and image SBFM exceptions.
- [ ] Replace the 240/minute challenge rule with a Pro-compatible empirically derived non-interactive ceiling.
- [x] Disable the blanket detail-page Managed Challenge.
- [x] Add an observe-only Worker rate-limit binding by public API route family; enforcement remains pending evidence.
- [ ] Provide documented API identities/quotas for legitimate bulk clients.
- [ ] Collect seven days of cache/rate/security metrics.
- [ ] Tune immutable, mutable, and negative TTLs from evidence.
- [ ] Record final expressions, thresholds, owners, and rollback procedures after the canary.

The first six-hour post-rollout sample is recorded in `cloudflare-production-baseline-2026-07-21.md`. It is not enough to
select the replacement document threshold: raw per-client totals include traffic excluded by the active rate expression,
and no event in that sample was attributed to the rate-rule ID. Preserve the current rule until rule-attributed events or
a longer distribution justify a change. The next implementation priority is an observe-first Worker route-family budget;
Cloudflare's binding is per-location and eventually consistent, and public anonymous IPs can represent shared users, so
enforcement must begin at a deliberately high threshold and exclude service-binding traffic.
