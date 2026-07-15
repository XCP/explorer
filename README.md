# XCP/explorer

Monorepo for the xcp.io rebuild (Cloudflare-native), modeled on XCP/exchange.

- `apps/api` — **api.xcp.io** Cloudflare Worker API (Hono + D1). Serves explorer reads, wallet search
  and market helpers, and native bare-multisig recovery backed by D1 and R2.
- `apps/web` — *(later)* the web app that replaces xcp.io at the root domain.
