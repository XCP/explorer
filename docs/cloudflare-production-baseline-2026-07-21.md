# Cloudflare production baseline — 2026-07-21

Sanitized, versioned record of the `xcp.io` zone after the first protection rollout. It contains no credentials, IP
allowlist values, or Access secrets. Cloudflare remains the live authority; verify rule IDs before changing them.

## Public routing

- `xcp.io/*`, `www.xcp.io/*` → `xcp-web`
- `api.xcp.io/*` → `xcp-api`
- `cdn.xcp.io` → `xcp-cdn`
- Web browsers use `https://api.xcp.io`; web server components use the `API_WORKER` service binding.
- API `workers.dev` remains enabled temporarily for rollback and legacy operator callers.

## Active custom protections, in evaluation order

1. Existing Telegram application exception.
2. Public API `GET|HEAD|OPTIONS /v2[/...]` and legacy `app.xcp.io/api/v1/*` reads: skip SBFM only.
3. Existing operator IP exception (values omitted).
4. CDN `GET|HEAD /img/...` and `/cdn-cgi/image/...`, plus transitional `app.xcp.io/img/...` reads used by installed
   wallet 0.5.0 clients: skip SBFM only.
5. Retired locale roots/prefixes (`en`, `es`, `de`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `ru`, `tr`, `uk`,
   `zh`, `cn`, `jp`) on the web hosts: return `410 Gone` at WAF.
6. Existing datacenter-ASN Managed Challenge, with verified bots plus the exact canonical/legacy public API and CDN
   image shapes above exempt because machine-readable clients and image elements cannot complete an HTML challenge.
7. Transaction-hash-shaped `/address/*` requests that cannot be supported address forms: block at WAF.
8. Retired `app.xcp.io/api/v1/asset/XCP` and `/api/v1/usd-prices` contracts: return `410 Gone` at WAF without invoking
   either Worker. Legacy search/swap remain temporarily available for already-installed wallet version 0.5.0.

The former blanket Managed Challenge for every `/asset/*`, `/address/*`, and `/tx/*` page is disabled. Do not restore
it as a substitute for route-specific limits.

Custom ruleset version 39 aligned the datacenter exception with the same exact image expression after rule-attributed
events showed legacy `app.xcp.io/img/*` wallet requests receiving Managed Challenges. Remove the transitional legacy
image clause after the wallet 0.5.1 adoption window; retain the canonical CDN clause.

Wallet extension 0.5.1 uses `api.xcp.io/v2` for price, asset search, and market pairs, and `cdn.xcp.io` for media. Retire
the remaining legacy search/swap forwarding only after 0.5.1 adoption is visible in traffic. Version 0.5.1 was
published as the latest GitHub release at 2026-07-21 23:58 UTC; do not treat its publication time as evidence that
already-installed 0.5.0 clients have upgraded.

## Initial post-rollout observation

The first six-hour GraphQL sample after the rollout is directional, not a seven-day baseline:

- the highest raw web-host client/minute group was 486 requests, but no event was attributed to the 240/minute
  document limiter; its static/RSC/verified-bot exclusions therefore matter and the raw total is not a valid replacement
  threshold;
- challenge-platform orchestration remained visible, so challenge counts must be attributed to their actual rule IDs
  before changing the document limiter;
- public traffic still reached `xcp-api.me-bbe.workers.dev`, confirming that the rollback origin cannot yet be called
  private or unused;
- the retired price contracts and locale prefixes returned edge `410`, while impossible 64-hex address routes returned
  edge `403`;
- Cloudflare managed rules already returned edge `403` for representative `/.git/config` and `/wp-login.php` probes, so
  duplicating those signatures in a custom rule would add complexity without avoiding additional Worker execution.

Cloudflare HTTP analytics also contain Worker Cache API/subrequest-shaped `204` and `504` populations. Do not interpret
those aggregates as public client failures without correlating Worker logs and external contract probes.

## Rate, managed WAF, cache, and zone settings

- Interim rate rule: 240 web-document requests/minute/IP/colo, Managed Challenge; Next static/data prefetch and verified
  bots exempt. Replace only after measured p99 traffic is available.
- Cloudflare managed ruleset and OWASP Core Ruleset are enabled.
- CDN cache rule remains enabled for `cdn.xcp.io`; the Worker supplies immutable or short fallback TTLs.
- Security level: essentially off; Browser Integrity Check: on; challenge passage: 30 minutes.
- Cache level: aggressive; Development Mode: off.

## Worker controls

- API and web Workers: Workers Logs enabled with 1% head sampling.
- API emits bounded `request_complete` records: method, route family, status, duration, edge-cache result, and D1-cache
  result. Raw entity identifiers and attacker-controlled paths are excluded.
- API Worker version `87cc4baa-1988-4048-ba36-4ca73794c253` adds an observe-only Rate Limiting binding at 600 public
  GETs/minute/client/route-family/Cloudflare location. Threshold crossings emit bounded `rate_budget_exceeded` records
  but never change the response. Reads without `CF-Connecting-IP`, including service-binding SSR traffic, bypass it.
- Browsers, public benchmarks, and contract tests target `api.xcp.io`. Operator scripts accept optional
  `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` headers for the planned Access boundary, but unattended admin
  defaults remain on `workers.dev` until those credentials exist.

## Known incomplete boundary

Cloudflare Access was not created because the current automation token is denied access to the Zero Trust Access API.
Until an Access-capable token or dashboard action is available, keep the API `workers.dev` origin enabled and retain the
application's constant-time Bearer authentication. After Access is tested on `api.xcp.io/admin/*`, protect or disable the
equivalent `workers.dev` admin origin before calling the boundary complete.

A 2026-07-21 canary confirmed this dependency: a direct unauthenticated `workers.dev/admin/status` reached application
Bearer authentication and returned JSON `401`, while `api.xcp.io/admin/status` was terminated before the Worker with a
Cloudflare HTML `403`. A Worker subrouter hostname guard also failed to observe the direct origin as assumed and was
removed before commit. Do not migrate unattended admin defaults or disable the direct origin based only on unit tests;
first prove an authenticated operator request through the Access-protected custom domain.

The current automation credential returns `403` for all three account endpoints below. A replacement account-scoped API
token needs `Access: Apps and Policies Read/Write` and `Access: Service Tokens Read/Write`, limited to this account:

- `GET /accounts/{account_id}/access/apps`
- `GET /accounts/{account_id}/access/service_tokens`
- `GET /accounts/{account_id}/access/organizations`

After provisioning the token, create the application and service token, verify one real operator request carrying
`CF-Access-Client-Id` and `CF-Access-Client-Secret`, and only then change operator defaults or the `workers.dev` boundary.

## Immediate rollback

- CDN breakage: restore the previous CDN Skip rule only long enough to diagnose, then re-scope it.
- Public API bot false positive: inspect the `/v2` SBFM-only Skip before changing managed WAF.
- Shadow rate-budget issue: remove the middleware and binding; because the current mode is observe-only, no threshold
  adjustment is required to restore client behavior.
- Locale false positive: disable the locale custom-response rule.
- Navigation issue: the blanket detail challenge is already disabled; do not enable it without a documented incident.
