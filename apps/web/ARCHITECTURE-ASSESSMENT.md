# Web architecture assessment

Status: assessment only  
Reviewed: 2026-07-12  
Scope: Next.js 16, React 19, OpenNext Cloudflare, component organization, server/client boundaries,
data access, caching, configuration, and tests

## Executive assessment

The web application is technically sound and already uses the important Next.js primitives correctly:
App Router routes, server-rendered detail pages, metadata, error/not-found/loading boundaries, client
islands, `next/font`, lazy loading for heavy browser libraries, a Cloudflare service binding, and an R2
incremental cache. OpenNext is the appropriate Cloudflare adapter and is not a reason to avoid normal
Next.js architecture.

The codebase is less successful as a navigable React/Next project. Fifty files are client entry points,
52 feature and shell components share one flat folder, `lib` mixes server access, client fetching, hooks,
JSX registries, and pure utilities, and the README describes files that no longer exist. The route tree is
easy to understand; the implementation tree below it is not organized around either routes or features.

Overall: **good runtime choices, increasingly flat application organization**. Preserve the App Router and
OpenNext setup; make server/client seams and feature ownership obvious.

## Direct answer: should React Compiler be enabled?

**Yes, as a measured adoption—not as a blind config toggle.**

React Compiler 1.x is stable, React 19 is the preferred target, and Next 16 has an optimized integration
that applies the compiler only to relevant files. This application has enough interactive client code to
benefit: tab systems, dense tables, transaction views, charts, polling status UI, menus, and large composed
client trees. It currently uses very little manual memoization, so the compiler can add useful render
reuse without replacing a large hand-written memo layer.

However, Compiler should not be expected to:

- reduce initial JavaScript caused by a broad client boundary;
- turn SWR/browser fetching into Server Component fetching;
- reduce Cloudflare cold starts;
- fix unnecessary effects or impure render behavior;
- replace profiling;
- improve mostly-static Server Components, which do not re-render in the browser.

Recommended adoption gate:

1. Add current `eslint-plugin-react-hooks` using its compiler-aware recommended preset.
2. Fix correctness-level Rules of React findings; allow the compiler to skip noncritical incompatible
   components initially.
3. Record current production build time, route chunks, browser smoke results, and one interaction profile
   for `DetailTabs`, `TxLive`, an index table, and the header.
4. Install an exact `babel-plugin-react-compiler` dev dependency and enable `reactCompiler: true` in a
   branch. Next's SWC pre-pass keeps the Babel work scoped.
5. Run the full Next build, OpenNext build/preview, and Playwright suite on Linux.
6. Compare interaction commits and build cost. Keep it if results are neutral-to-positive.
7. Preserve existing `useMemo`/`useCallback` until there is a reason to remove them. They may encode effect
   dependency stability, not merely render optimization.

Annotation mode is useful if the lint audit reveals widespread incompatibility. Otherwise, full infer mode
is preferable to accumulating `"use memo"` directives throughout a modest codebase. Use `"use no memo"`
only as a documented, temporary escape hatch.

## OpenNext and Cloudflare assessment

### What is correct

- `@opennextjs/cloudflare` supports all Next 16 minor/patch versions and the App Router features used here.
- The application correctly stays on the default Next Node.js runtime; OpenNext specifically recommends
  Node rather than Next's Edge runtime.
- `nodejs_compat` is correct for the generated OpenNext Worker.
- The `API_WORKER` service binding avoids a public Worker-to-Worker network hop.
- R2 is the right persistent incremental-cache backend for a site using revalidation.
- `initOpenNextCloudflareForDev()` is present, so bindings are available under `next dev`.
- deployment uses the OpenNext CLI rather than invoking Wrangler directly.
- `public/_headers` exists for static asset policy.
- heavy browser-only dependencies (`reagraph`, `lightweight-charts`, DOMPurify inspector) are already split
  from common routes.

### P1 — Complete or deliberately simplify the revalidation architecture

The current OpenNext config supplies only the R2 incremental cache. Current OpenNext guidance for a small
site using time-based revalidation recommends an R2 incremental cache plus a Durable Object-backed queue
to synchronize and deduplicate revalidations. Regional cache wrapping is also recommended for R2-backed
cache performance. A tag cache is necessary only if the application adopts on-demand `revalidateTag` or
`revalidatePath`.

Decide explicitly between:

- **time-based revalidation in production:** configure the supported queue/self-reference and evaluate the
  regional cache wrapper; or
- **API/edge caching only:** simplify the Next cache claims and avoid maintaining a partial ISR setup.

Do not add a tag cache until tag/path revalidation is actually used.

### P1 — Verify service-binding data-cache semantics

`getJson` passes `next: { revalidate }` into `API_WORKER.fetch`. Next's fetch instrumentation and request
memoization apply to the patched global `fetch`; a Cloudflare `Fetcher` binding is a different API. The
binding may correctly avoid network overhead while still bypassing Next's fetch cache. The current comments
assert that these reads persist in the R2 Data Cache, but the codebase has no test proving it.

Add a deployed verification that records API binding calls across:

- two `getJson` calls in one render (metadata plus page);
- two requests within the revalidation window;
- the first request after expiry;
- simultaneous requests after expiry.

If the binding bypasses fetch caching, use one of these explicit designs:

1. wrap server data functions in a supported Next cache primitive and keep binding fetch as the source;
2. use route/segment caching for the rendered result;
3. accept API-level caching and remove misleading Next Data Cache expectations.

Do not give up the service binding merely to regain patched global fetch without measuring the tradeoff.

### P1 — Generate Cloudflare binding types

`lib/api.ts` locally recreates a `WorkerBinding` shape and casts `getCloudflareContext().env`. OpenNext
documents `wrangler types --env-interface CloudflareEnv` for bindings. Generate and check binding types
whenever Wrangler configuration changes, then consume `CloudflareEnv` directly.

### P1 — Update platform configuration on a tested cadence

The web Worker compatibility date is `2025-03-01`. Update it separately from application changes and run an
OpenNext preview/build test. Keep `@opennextjs/cloudflare` current within a deliberate upgrade cadence.
OpenNext's Next 16 support is current, but its Windows support remains best-effort; builds and deployment
verification should run on Linux CI even if local development stays on Windows.

### P2 — Evaluate Turbopack rather than permanently forcing webpack

The production build script explicitly uses `next build --webpack`. Next 16 defaults to Turbopack, and
current OpenNext supports it. The override may reflect a real prior compatibility issue, but that reason is
not recorded.

Create a separate Turbopack build experiment. Compare:

- Next build success and duration;
- OpenNext transformation and Worker size;
- CSS output and the lab-derived global stylesheet;
- dynamic imports for charts, graph, and inspector;
- Playwright behavior.

Keep webpack if it is more reliable, but document the incompatibility and a review date. “Known-good” is a
valid production choice; unexplained permanent divergence is not.

## Next.js application structure

### What is already conventional

- `src/app` is primarily routing code.
- Routes use standard `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, and `not-found.tsx` conventions.
- Dynamic segments use normal `[asset]`, `[address]`, `[hash]`, `[n]`, `[tag]`, and `[tier]` names.
- Thin generic record pages are reasonable and easy to scan.
- Dynamic detail routes fetch on the server and return meaningful metadata.
- Server Components can pass rendered children into client islands without turning the whole tree into
  client code; the root `SWRProvider` pattern is valid.
- `components/ui` is a useful shared-primitives boundary.
- `@xcp/shared` is correctly transpiled by Next and remains the wire-contract package.

### P1 — Replace the flat component directory with feature ownership

The current folder contains shell, asset, address, transaction, market, graph, collection, table, and
generic infrastructure components as peers. Names such as `relationships.tsx`, `reputation.tsx`,
`detail-tabs.tsx`, or `pending-actions.tsx` do not reveal which routes own them without searching imports.

Use a hybrid feature-first structure:

```text
src/
  app/                         routing and route-local composition
  features/
    assets/
      components/
      data/
      hooks/
      model.ts
    addresses/
      components/
      data/
    transactions/
      components/
      data/
    records/
      components/
      registry.tsx
    collections/
    reputation/
    graph/
  components/
    ui/                        reusable visual primitives
    chrome/                    header, footer, search, status, section chrome
  lib/
    api/
    format/
```

Feature folders should not become miniature layered architectures by default. Add `data/` or `hooks/`
only when the feature owns enough code to justify them.

An equally Next-native alternative is route colocation (`app/asset/[asset]/_components`). Use that for
components truly owned by one route. Prefer `features/` when asset components are shared by asset pages,
transactions, collections, and tables. Next explicitly supports both patterns.

### P1 — Make server and client modules unmistakable

`lib/api.ts` currently contains:

- URL construction shared by both environments;
- the SWR client fetcher;
- an OpenNext/Cloudflare server binding lookup;
- server error types and server cached reads.

Split it:

```text
lib/api/url.ts               environment-safe URL construction
lib/api/client.ts            SWR fetcher; `client-only` if useful
lib/api/server.ts            `server-only`; getCloudflareContext and server reads
lib/api/errors.ts            shared only if both environments truly need it
```

This prevents accidental server capability imports into client graphs and makes code review easier. Apply
the same rule to feature data modules: `.server.ts` for server-only access, hooks in client modules.

### P1 — Move toward server-first initial data

Fifty of 113 TypeScript/TSX files begin a client boundary. Many need it, but several route-level features
fetch all initial content with SWR even though the page itself is static and read-only. That yields a server
shell followed by browser data, misses HTML/SEO value, and requires more hydration than necessary.

The asset, address, block, tag, and transaction routes demonstrate the better pattern:

- fetch initial canonical data in a Server Component;
- render meaningful HTML immediately;
- pass serializable initial data into a narrow client island only for pagination, polling, tabs, filters,
  or live state;
- let SWR hydrate from fallback/initial data rather than refetching immediately.

Apply this selectively to home, assets, blocks, generic indexes, collections, firsts, radar, leaderboards,
vaults, exchanges, and stats. Keep mempool and rapidly changing transaction status client-driven.

For paginated indexes, consider URL `searchParams` plus Server Components first. This gives linkable pages,
browser history, and server-rendered results. A client transition layer can preserve the current quick UX.

### P1 — Establish a server data-function convention

Dynamic routes duplicate a useful but local pattern: `loadAsset`, `loadBlock`, `loadTx`, and `loadTag`
translate API 404s and serve both metadata and page rendering. Move toward feature-owned server data
functions with consistent names and caching semantics:

```text
features/assets/data/get-asset.server.ts
features/blocks/data/get-block.server.ts
```

Use React `cache()` for same-render deduplication when the underlying operation is a service-binding fetch
that may not receive Next global-fetch memoization. Keep freshness/revalidation policy explicit and separate
from 404 translation.

### P2 — Use route groups only where they add a real concept

Route groups are not required merely because many routes exist. Potentially useful groups are:

- `(records)` for the many generic protocol feed routes if shared loading/error/layout behavior emerges;
- `(labs)` for `graph` and `tx-lab`, ideally excluded or access-controlled in production;
- `(explorer)` only if detail/index routes gain shared segment behavior distinct from the root shell.

Moving everything into decorative groups would add churn without improving ownership.

### P2 — Give experimental surfaces an explicit lifecycle

`/graph` is described as an unlinked R&D scratch page and `/tx-lab` as temporary QA. They are still
production routes. Put experimental routes behind an environment gate, access control, or a documented
`(labs)` convention with owners and deletion criteria. `robots: noindex` is useful but not a lifecycle.

## Naming assessment

### Good patterns

- Next special files use framework-standard names.
- React component symbols use PascalCase; source filenames consistently use kebab-case.
- `use*` hooks follow React convention.
- shared wire types are imported rather than shadowed locally.
- transaction files already form a recognizable domain prefix (`tx-view`, `tx-offer`, `tx-receipt`, etc.).

### Improvements

- Folder ownership is more important than adding longer filename prefixes. After moving into
  `features/transactions`, prefer `view.tsx`, `offer.tsx`, or more semantic names such as
  `transaction-live-view.tsx` based on local ambiguity.
- Avoid multi-concept files named by broad nouns (`relationships.tsx`, `reputation.tsx`). Name the single
  component/capability or split it.
- `lib` should contain framework-neutral infrastructure or clearly named subdomains, not all code that is
  “not a component.” `cells.tsx`, `registry.tsx`, `mempool.tsx`, and `tx.ts` belong to features.
- `Page` is conventional for tiny Next route files, but meaningful default function names improve stack
  traces for complex pages (`AssetPage`, `AddressPage`, `ReputationPage`).
- Keep `components/ui` primitives generic; domain-aware `AssetIcon` may ultimately belong to the asset
  feature even if visually primitive.

## Configuration and framework opportunities

### P1 — Add React/Next lint coverage before Compiler

The workspace ESLint config currently enforces TypeScript `any` and file length but does not use the current
React Hooks recommended rules. Add `eslint-plugin-react-hooks` for Rules of Hooks, exhaustive dependencies,
purity, refs, incompatible libraries, and Compiler diagnostics. This is valuable even if Compiler adoption
is delayed.

### P1 — Build the actual deployment artifact in CI

CI currently runs workspace checks and API tests only. It does not run:

- `next build`;
- Playwright smoke tests;
- an OpenNext build;
- Worker-size reporting;
- Wrangler binding type generation/checking.

At minimum, add a Linux job for `next build` and the browser smoke suite. Add an OpenNext build/preview smoke
job before platform upgrades and ideally on every main/PR build if duration is acceptable. This closes the
largest gap between local correctness and the deployed runtime.

### P2 — Enable typed routes

With roughly 40 routes and many programmatic `Link` targets, `typedRoutes: true` is a useful Next-native
safety improvement. Trial it after organizing experimental/dynamic links; fix or narrowly cast genuinely
dynamic URLs rather than weakening the setting globally.

### P2 — Do not enable Cache Components/PPR merely because they exist

OpenNext supports composable caching and PPR, but the app should first make server data access and cache
semantics explicit. `cacheComponents` changes the rendering/caching model and would complicate an already
uncertain service-binding cache path. Revisit it after server-first conversion and deployed cache tests.

### P2 — Keep intentional `<img>` use, but document the policy centrally

The project deliberately avoids `next/image` for immutable CDN icons and media fallbacks. That can be
correct on OpenNext, particularly for GIF/video/protocol media and an external image service. Put the rule
in the architecture/README rather than repeating incident history in component comments. Re-evaluate
Cloudflare Images only if transformation, responsive formats, or origin protection become product needs.

### P2 — Stop tracking generated `next-env.d.ts`

Current Next documentation marks `next-env.d.ts` as generated and not to be tracked. It repeatedly changes
between `.next/types` and `.next/dev/types` during local build/test workflows, creating noise. Ignore it and
let Next regenerate it. Ensure CI generates it before type checking.

## Documentation and discoverability

The web README is materially stale: it references `src/lib/indexes.tsx`, a consolidated `ui.tsx`, and
`nav.tsx`, none of which exists. Its hook inventory also names removed hooks. A stale map is worse than no
map because it teaches new contributors the wrong architecture.

After establishing the target folders, update README with:

- runtime/deployment model (Next Node runtime -> OpenNext -> Cloudflare Worker);
- local `next dev` versus OpenNext `preview` distinction;
- server API binding behavior and public-fetch fallback;
- cache topology;
- feature/shared/chrome folder rules;
- where Server Components, client islands, hooks, and wire types belong;
- build/test/deploy commands that CI actually runs.

## Recommended target tree

```text
apps/web/
  next.config.ts
  open-next.config.ts
  wrangler.toml
  src/
    app/
      layout.tsx
      error.tsx
      not-found.tsx
      loading.tsx
      asset/[asset]/page.tsx
      address/[address]/page.tsx
      tx/[hash]/page.tsx
      ...
    components/
      chrome/
      ui/
    features/
      assets/
      addresses/
      transactions/
      records/
      collections/
      reputation/
      graph/
    lib/
      api/
        url.ts
        client.ts
        server.ts
      format/
  tests/
    e2e/
```

The `app` directory stays a route and composition map. A contributor looking for asset behavior goes to
`features/assets`; someone looking for site-wide visual primitives goes to `components/ui`; someone looking
for Cloudflare data access goes to `lib/api/server.ts`.

## Suggested sequence

1. Correct the README and stop tracking `next-env.d.ts`.
2. Add React Hooks/Compiler-aware lint rules.
3. Split `lib/api.ts` into server/client/shared modules and generate Cloudflare binding types.
4. Add Next build, Playwright, and OpenNext build coverage to Linux CI.
5. Verify service-binding caching and complete the chosen OpenNext revalidation topology.
6. Pilot React Compiler; retain only with build/browser/profile evidence.
7. Create `components/chrome` and feature folders; move one coherent domain at a time without behavior
   changes, starting with transactions or assets.
8. Convert high-value read-only pages to server-first initial data with small client islands.
9. Trial typed routes.
10. Trial Turbopack separately; document webpack if retained.
11. Revisit Cache Components/PPR only after cache ownership is clear.

Avoid mixing folder movement, visual changes, and data-fetch changes in one commit. A component move should
be mechanically reviewable; server-first conversion should have its own performance and browser evidence.

## Practices not recommended here

- Do not replace OpenNext with a custom Worker integration.
- Do not adopt the Next Edge runtime; OpenNext's Node runtime is the supported, fuller path.
- Do not move every shared component into the nearest route and create duplication.
- Do not turn every feature into `components/hooks/services/utils/types` folders before they need them.
- Do not enable every Next 16 feature at once.
- Do not use React Compiler as justification for ignoring Rules of React or profiling.
- Do not introduce a global state library; SWR plus local state fits the current read-heavy application.
- Do not proxy the entire public API through Next route handlers; direct browser API reads and the server
  service binding already have clear roles.
- Do not convert intentional media `<img>`/`video` fallbacks to `next/image` mechanically.

## Reference guidance

- [Next.js project organization](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js React Compiler configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler)
- [React Compiler introduction](https://react.dev/learn/react-compiler/introduction)
- [React Compiler installation and lint integration](https://react.dev/learn/react-compiler/installation)
- [React Hooks/Compiler ESLint rules](https://react.dev/reference/eslint-plugin-react-hooks)
- [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare)
- [OpenNext Cloudflare caching](https://opennext.js.org/cloudflare/caching)
- [OpenNext Cloudflare performance guidance](https://opennext.js.org/cloudflare/perf)
- [OpenNext Cloudflare bindings](https://opennext.js.org/cloudflare/bindings)
- [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)

