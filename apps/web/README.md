# xcp.io Explorer (web)

Counterparty explorer — Next.js (App Router) + SWR + Tailwind v4, deployed to Cloudflare via OpenNext.
Read-only; consumes **api.xcp.io** (the D1 Counterparty mirror). Design logic in [DESIGN.md](./DESIGN.md).

## Run locally
```bash
npm install
npm run dev            # http://localhost:3000
```
By default it talks to the live API (`https://xcp-api.me-bbe.workers.dev`). To point elsewhere
(e.g. a local `apps/api` via `wrangler dev`), create `.env.local`:
```
NEXT_PUBLIC_API_BASE=http://localhost:8787
```

## Build / deploy
```bash
npm run build          # next build (validates all routes)
npm run deploy         # opennextjs-cloudflare build && deploy  (Cloudflare worker: xcp-web)
```

## Layout
- `src/lib/api.ts` — API client + envelope fetcher (base = `NEXT_PUBLIC_API_BASE`).
- `src/lib/swr-provider.tsx` — SWR cache (dedupe, no focus-revalidate, keepPrevious).
- `src/lib/hooks.ts` — typed hooks per endpoint (`useAssets`, `useAsset`, `useAddress*`, `useBlock(s)`, `useTx`, `useIndex`).
- `src/lib/indexes.tsx` — column config for every index page (one place for per-model display).
- `src/components/` — `ui.tsx` (Card/Table/Row/Cell/badges/buttons), `index-page.tsx` (generic index), `nav.tsx`.
- `src/app/` — routes: `/` (dashboard), `/assets`, `/asset/[asset]`, `/address/[address]`, `/block/[n]`,
  `/tx/[hash]`, and index pages (`/sends`, `/issuances`, `/orders`, `/matches`, `/dispensers`, `/dispenses`,
  `/sweeps`, `/broadcasts`, `/burns`, `/dividends`, `/bets`, `/fairminters`, `/fairmints`, `/destructions`,
  `/btcpays`, `/transactions`).
