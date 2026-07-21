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
4. CDN `GET|HEAD /img/...` and `/cdn-cgi/image/...`: skip SBFM only.
5. Retired locale roots/prefixes (`en`, `es`, `de`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `ru`, `tr`, `uk`,
   `zh`, `cn`, `jp`) on the web hosts: return `410 Gone` at WAF.
6. Existing datacenter-ASN Managed Challenge, with verified bots plus the exact canonical/legacy public API and CDN
   image shapes above exempt because machine-readable clients and image elements cannot complete an HTML challenge.
7. Transaction-hash-shaped `/address/*` requests that cannot be supported address forms: block at WAF.

The former blanket Managed Challenge for every `/asset/*`, `/address/*`, and `/tx/*` page is disabled. Do not restore
it as a substitute for route-specific limits.

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
- Browsers and public benchmarks target `api.xcp.io`. Operator scripts accept optional `CF_ACCESS_CLIENT_ID` and
  `CF_ACCESS_CLIENT_SECRET` headers for the planned Access boundary, but unattended admin defaults remain on
  `workers.dev` until those credentials exist.

## Known incomplete boundary

Cloudflare Access was not created because the current automation token is denied access to the Zero Trust Access API.
Until an Access-capable token or dashboard action is available, keep the API `workers.dev` origin enabled and retain the
application's constant-time Bearer authentication. After Access is tested on `api.xcp.io/admin/*`, protect or disable the
equivalent `workers.dev` admin origin before calling the boundary complete.

## Immediate rollback

- CDN breakage: restore the previous CDN Skip rule only long enough to diagnose, then re-scope it.
- Public API bot false positive: inspect the `/v2` SBFM-only Skip before changing managed WAF.
- Locale false positive: disable the locale custom-response rule.
- Navigation issue: the blanket detail challenge is already disabled; do not enable it without a documented incident.
