# XCP/explorer

Monorepo for the xcp.io rebuild (Cloudflare-native), modeled on XCP/exchange.

- `apps/api` — **api.xcp.io** Cloudflare Worker API (Hono + D1). Serves the xcp.io API, including the
  endpoints the Nebo wallet extension depends on (search, asset, swap, utxos, consolidation), replacing
  the legacy app.xcp.io Laravel droplet.
- `apps/web` — *(later)* the web app that replaces xcp.io at the root domain.
