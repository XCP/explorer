# xcp.io Explorer (web)

Counterparty explorer built with Next.js App Router, React, SWR, and Tailwind, deployed to Cloudflare
Workers through OpenNext. The application consumes the `xcp-api` Worker.

## Run locally

```bash
npm install
npm run dev -w xcp-explorer-web
```

By default the app reads the live API. To point at a local API, create `apps/web/.env.local`:

```text
NEXT_PUBLIC_API_BASE=http://localhost:8787
```

## Runtime and deployment

The App Router runs in Next's Node.js runtime. OpenNext transforms the production build into the `xcp-web`
Cloudflare Worker. Server Components call the API through the `API_WORKER` service binding in production;
browser requests and ordinary local development use `NEXT_PUBLIC_API_BASE`. R2 stores OpenNext's
incremental cache.

Use `next dev` for normal UI work. Use an OpenNext preview/build when changing Cloudflare bindings, caching,
runtime compatibility, or deployment configuration. OpenNext's Windows support is best-effort, so Linux CI
is the authoritative deployment build.

```bash
npm run build -w xcp-explorer-web
npm run test:e2e -w xcp-explorer-web
npm run deploy -w xcp-explorer-web
```

## Source map

- `src/app/` — routes, layouts, metadata, and route composition.
- `src/components/ui/` — shared visual primitives.
- `src/components/` — current shared and feature components; these are being grouped into `chrome/` and
  feature-owned folders as described in the architecture assessment.
- `src/lib/api/` — environment-neutral URL construction plus explicit browser and server/Cloudflare clients.
- `src/lib/hooks.ts` — shared SWR hooks for live and paginated reads.
- `src/lib/registry.tsx` — typed record-table definitions.
- `src/lib/cells.tsx` — shared record-table cell renderers and column contracts.
- `packages/shared` — API/web wire DTOs and record kinds.

Architecture and visual references:

- [`ARCHITECTURE-ASSESSMENT.md`](./ARCHITECTURE-ASSESSMENT.md)
- [`DESIGN.md`](./DESIGN.md)
- [`TABLES.md`](./TABLES.md)
