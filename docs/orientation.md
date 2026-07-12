# Orientation — read this first

You're working on **xcp.io**, the Counterparty blockchain explorer. This file orients a new agent in
minutes: what the product is, how the repo is shaped, how we work, what's shipped, what's mid-flight,
and what's slated. The hard rules live in `CLAUDE.md` (root) — they are non-negotiable; this file is
context, not law. Deeper reading: `apps/api/docs/architecture.md` (data), `docs/product-inventory.md`
(the justify-existence audit), `docs/product-direction.md` (the strategy).

## What this product is

Counterparty is a 2014 Bitcoin meta-protocol; its living culture is Rare Pepe, art/trading cards,
Bitcoin Stamps. xcp.io is **the trust-and-taste layer** for that world: the one place that scores
what's good and proves who's real — then deep-links the *doing* (buying, trading) to xcpdex/Digirare/
wallets. We are the knowledge product, never the exchange (see `docs/product-direction.md` for the
full positioning, the Collector-first ICP, and the ranked bets).

The moat is the **judgment layer** on top of the mirror, not the mirror itself:
- **Asset quality** — realized-value-led score → tiers Bluechip/Premium/Notable/Speculative
  (`apps/api/src/reputation/config.ts` is the tuning surface; `score.ts` the generic engine).
- **Address reputation** — evidence-led trust/distrust, tiers OG/Established/Active/Casual, explicit
  bad-actor penalties (Emblem vault/shell/dump scams). Infra (exchange/deposit/vault/burn/service)
  is curated in the D1 `curated` table and never user-scored.
- **Conviction** — who HOLDS an asset + scarcity, deliberately market-blind. Powers Radar
  (undervalued = conviction ≫ realized price) and now shows on asset pages.
- **Holder cohesion** — wash/insularity detector (edges among top holders ÷ holders; traded-asset
  median ≈ 4; `insular` chip fires at ≥9 AND ≥$1k realized).
- **The Emblem census** — ~60k Ethereum-wrapped vaults attributed to Counterparty assets, ~117k
  recovered cross-chain sales. No competitor has this.

## Repo shape (the 60-second map)

```
apps/api        Cloudflare Worker (Hono) + D1 "xcpio" — api.xcp.io / xcp-api.me-bbe.workers.dev
  src/read/     thin route modules (parse → query → envelope)
  src/queries/  ALL SQL, typed functions, one file per domain (SQL never crosses modules)
  src/indexer/  the mirrors + derived builders: Counterparty replayer (events/), Emblem stack
                (emblem*.ts, vault-contents, seaport), signals, tags, collections, trades, prices,
                graph (PageRank→graph_trust), holder-cohesion
  src/reputation/ pure scoring: config.ts (every weight/threshold) + score.ts + persona.ts
  migrations/   numbered DDL — every new table/index gets one
apps/web        Next.js 15 on OpenNext/Cloudflare — xcp.io / xcp-web.me-bbe.workers.dev
  src/lib/      api.ts, registry.tsx (record catalog → columns per kind), cells.tsx (v20 cell
                grammar), format.ts, art.ts (CDN image URLs), tx.ts
  src/components/ flat; RecordTable renders every table on the v20 grammar
packages/shared the WIRE contract only (one file per domain); D1 row shapes live in apps/api/src/storage-types.ts
design-lab/     the owner-approved HTML references (v19 frame, v20 tables) — port VERBATIM, never freelance
```

## How we work here (learned the hard way)

- **The owner reviews taste, not plumbing.** Do the practitioner floor yourself; surface only real
  design forks, with rendered screenshots (playwright is installed in the scratchpad — capture, look
  at your own screenshots, fix what you see BEFORE showing the owner).
- **Think → test → repeat.** State product bets as falsifiable data tests; probe prod D1 before
  believing any claim (several "obvious" cut/keep calls this quarter were wrong until tested).
- **Verify on the real origins.** www.xcp.io serves a STALE deployment — always check
  `xcp-web.me-bbe.workers.dev` / `xcp-api.me-bbe.workers.dev`. Web builds with `next build
  --webpack` (OpenNext can't load Turbopack chunks). Expect brief chunk-skew after web deploys.
- **Prod deploys are owner-gated.** The permission classifier blocks `wrangler deploy` per-change;
  get an explicit go. Admin/backfill ops run through `wrangler dev --remote` + gitignored
  `.dev.vars` (never touch prod secrets). Full reindexes require the cron PAUSED
  (`indexer_state.cron_paused='1'`) — two write drivers ⇒ D1 SQLITE_NOMEM.
- **D1 quirks:** compound SELECT term cap (use `db.batch` for probe fans); check indexes before
  point-probing big tables (block-scope rides `idx_*_block` when tx_hash isn't indexed); `cached()`
  in read/respond.ts gives D1-backed response caching with stale-while-revalidate — long `swr` for
  anything expensive (an expired stats cache once made the whole site feel dead).
- **Curation is data, not code:** exchanges/burns/deposits → `curated` table (+ flip the
  `address_signals` flag for immediate effect); removed collections → `EXCLUDED_COLLECTIONS` in
  `indexer/collections.ts`; manual collection tags → `source='manual'` (crawl-proof).
- **Agents:** implementation is done hands-on by the main agent; sub-agent fan-outs are welcome for
  ideation/analysis (persona panels, research) when the owner asks. Plain .md for internal docs —
  designed artifacts are for product UI and design exploration only.

## Shipped (highlights, newest first)

- **The transaction page, rebuilt end-to-end** — the session's centerpiece. Concept (owner's): a tx
  page has one of three JOBS. ① **Offer** — a dispenser/fairminter/order has no page but its tx page,
  so the page IS the storefront: art + collection + supply under the image, price-first, live
  stock/fill bars, how-to blocks with copy buttons and a wallet-wired "Fill order" button, sales/
  matches tape below (dispenser-sales pattern; match Views cross-link the two sides). Dead offers
  keep the SAME frame with state pill + toned ended-block. ② **Receipt** — settled proof with line
  items, parties, cross-links back to living storefronts. ③ **Declaration** — broadcast as a
  quotation, issuance as a birth certificate handing off to the asset page. Plus: mempool-aware
  live header (Unconfirmed → Confirmed → red **Invalid** tri-state with the node's reason),
  kind-named first tab + **Bitcoin** tab (inputs left/outputs right, expandable rows; mempool.space
  with Counterparty-node fallback) + **Events** tab (raw node events), localized timestamps, TX fee
  with sat/vB, share unfurls that sell ("Buy PEPECASH — 0.0000x BTC · OPEN" + card art), `/tx-lab`
  QA index (temporary — one deep link per kind × status; delete after review).
- **Holder cohesion** as a stored signal (migration 0040, all 8.5k traded candidates scored) + the
  insular chip and integrity band.
- **Conviction on asset pages** + the `undervalued` pill (Radar-parity math and gates).
- **AssetArt media cascade** — resized → raw → `<video>` (fixes 9412 on video assets like TRAMPS).
- **Persona classifier** (`reputation/persona.ts` + PERSONA config + headline on the reputation
  card) — built mid-pivot, live, but the owner never formally blessed it: it owes a keep/delete
  review (see docs/product-inventory.md H2).
- Collections: canonical-slug dedup, EXCLUDED_COLLECTIONS, series/card/artist tags, community-
  strength scoring. Emblem: census + sales recovery + scam engines + reputation penalties.
  Reputation: age-cap, decay, buyer-gated realized value, curated infra states. (Earlier quarters —
  see git log and apps/api/docs/*.)

## In progress (self-driving — check before assuming stale)

- **Emblem sales recovery** — actively backfilling (+23k sales in 2 days as of 2026-07-11); cursors
  in `indexer_state` (`emblem_sales_*`). **Transfers crawl** at ~contract 19/37 (`emblem_tx_*`,
  floor 19.6M ≈ Apr 2024). **Vault-contents verification** loops perpetually.
- **The tx-page framework iteration** — owner is actively refining copy/layout in short loops; the
  order tab is the most-dialed exemplar of the pattern.

## Slated / decided-but-not-built (the backlog that matters)

From `docs/product-direction.md` (owner accepted the frame; bets ranked there):
1. **Verdict headers everywhere** — asset page tier badge placement is explicitly ON HOLD (owner:
   rank-vs-verdict confusion must be fixed first — the 0-100 score and the tier need to stop
   sharing the "Rating" label).
2. **Home front door rebuilt** on the collector's four questions; lift Radar/Collections/
   Leaderboards/Firsts out of the dropdowns.
3. **Vocabulary + methodology page** (make Bluechip/Conviction citeable); Emblem-census PR wedge.
4. **Watchlist/memory** (localStorage first). 5. **Named-verdicts** (the scam wall) — owner has NOT
   ruled; do not ship.
Also slated: dispenser/fairminter dead-states → the one-frame conversion the order got; wallet
provider's real compose API (the "Fill order" button's integration point is marked); OPEN_POOL txs
unclassifiable (pools mirror lacks tx_hash — capture change); dispenser-close txs land on the
generic fallback; related-tab thumbnails lack the video cascade; some pre-2023 `invalid:*` statuses
carry mojibake from capture; delete `/tx-lab` + the `/graph` page (confirmed dead; keep the
signal chips) when the owner calls it.

## Live state cheat-sheet

Worker `xcp-api`, D1 `xcpio` (~7.5GB), cron */2min. Key tables: mirror (transactions, sends, orders,
dispensers/dispenses, issuances, fairmint*, broadcasts, sweeps…), derived (asset_signals,
address_signals, trades, tags, graph_*, emblem_*, prices, curated, cache). The `cache` table backs
`cached()`. Admin routes are Bearer-gated (`/admin/*`); tokens live in gitignored files — never
commit them.
