# xcp.io — Design Direction (v2)

## What kind of product this is

Reference species considered: Etherscan (infrastructure utility — works only on high-volume
chains), GeckoTerminal (degen trading terminal — wrong energy for a historic chain), DefiLlama
(analytics authority), GONDI (art marketplace — neutral chrome, the art provides the color),
Tokenscan (the raw mirror — already exists; competing on table-dumps is a losing game).

**xcp.io is squarely an explorer — the reference site that knows everything about Counterparty,
with an intelligence layer no raw mirror has.** The product family divides the jobs:

| Site | Job |
|---|---|
| **xcp.io** (this) | Explore & know: search, records, provenance, scores, sales history |
| **xcpdex** | Trade: the exchange |
| **Digirare** | Collect: the NFT-focused browsing/collecting site |

The explorer shows the art and the market *as knowledge* (what sold, what's real, who holds it) and
deep-links the *doing* — trading to xcpdex, collecting to Digirare. Its unique holdings — the things
no other Counterparty surface has:

1. The unified cross-venue **trades ledger with USD values** (DEX + dispensers + Emblem).
2. The **quality/reputation intelligence** (scores, tiers, holder makeup).
3. The **art**, curated (featured scoring + has_media + collections).
4. Twelve years of **history** (Firsts, provenance, OG reputation).

Every layout decision serves those four. "What just sold, for how many real dollars" is the most
compelling sentence this product can say; "look at the art" is the most beautiful one.

## Design principles

1. **The art and the money first.** Lead surfaces show sales (USD) and artwork, not plumbing.
   Blocks/transactions are utility reached via search and links — never the hero.
2. **Chrome is neutral; content provides the color.** Asset art and market deltas are the only
   saturated things on a screen. The UI itself stays zinc.
3. **AA contrast floor.** No informational text below 4.5:1 on its background. On zinc-950 that
   means: muted text is `zinc-400`, never `zinc-500`; `zinc-500` is the floor for decorative-only.
4. **Red and green are market semantics, exclusively.** Up/down, buy/sell, open/locked. Red never
   decorates, accents, or focuses — that's what makes it legible as a signal.
5. **Brand is a mark, not a paint.** Crimson `#ec1550` appears on the logo and the single primary
   CTA (Connect Wallet). Nothing else. Scarcity is what makes it premium instead of alarming.
6. **Mono for data.** Numbers, quantities, hashes, addresses, heights: Geist Mono + tabular-nums.
7. **Density follows data.** Counterparty is low-volume: dense tables where data is genuinely
   dense (records, holders), air and imagery where it isn't (home, asset pages).

## Tokens (Tailwind v4 `@theme` — globals.css is the source of truth)

| Token | Value | Use |
|---|---|---|
| `--color-background` | `#09090b` zinc-950 | page bg |
| surface | `zinc-900/50` on `zinc-950`, 1px `zinc-800` border | cards, panels |
| text primary | `zinc-100` | headings, names, key values |
| text secondary | `zinc-300` | body, table values |
| text muted | `zinc-400` (**AA floor for information**) | labels, timestamps, secondary cells |
| text decorative | `zinc-500` | placeholders, dividers, purely-cosmetic |
| `--color-brand` | `#ec1550` | logo + Connect Wallet ONLY |
| `--color-accent` | `#38bdf8` sky-400 | links hover, active nav/tabs, focus ring, charts, selection |
| `--color-up` | `green-400` | positive deltas, buys, open |
| `--color-down` | `red-400` | negative deltas, sells, locked |
| font sans / mono | Geist / Geist Mono | UI / all data |

## Home page hierarchy (the species decision, applied)

The core audience behavior: **power users check daily and want "what's happening right now" in the
first screenful.** The home is a *now* dashboard, then the museum, then the reference.

1. Tight hero: identity line + search.
2. **Now strip** — live vitals: tip block, mempool pending count, last-block age. Small, live.
3. **Happening now** — the daily-check row: **Latest sales** (trades ledger, USD-first:
   "RAREPEPE · $114 · dispenser · 2m") · **Mempool** (pending actions, unconfirmed treatment) ·
   **Latest transactions**. Freshness is the product here; timestamps prominent, polling live.
4. **Featured art grid** — quality-scored assets with media; the museum face, below the now-fold.
5. Activity chart — secondary, drawn in accent (a red activity chart reads as an incident).
6. Compact record feeds last (deep cuts for browsing).

## App chrome (header + footer carry the brand)

**Header** (iterating — the highest-traffic UI in the product):
- Brand mark: `xcp.io` wordmark with crimson dot — the one place brand red always lives.
- Nav IA: Assets · Trades · Blocks · Records ▾ · Discover ▾ (intent-ranked; see nav-menu.tsx).
- Search: the hero utility — `/` shortcut chip, shape-routing; candidates: ⌘K affordance,
  typeahead suggestions (assets by prefix) as a later feature.
- Buttons: exactly one primary (Connect Wallet, brand); everything else quiet.
- Tickers: BTC/XCP compact, tabular-nums; drop below md.

**Footer** (generous — the explorer's site map + trust signals, Etherscan-fat, not a strip):
- 4 columns: **Explore** (Assets, Trades, Blocks, Mempool, all records) · **Discover**
  (Leaderboards, Firsts, Vaults, Exchanges, Stats) · **Ecosystem** (xcpdex, Digirare, Wallet,
  counterparty.io, GitHub) · **Data** (API, docs, this repo).
- Brand row: wordmark + "Counterparty blockchain explorer — on Bitcoin since 2014."
- The interesting bit: a **live sync line** — "Synced to block 956,948 · n pending" — the
  explorer's heartbeat, in the footer on every page.

## Component recipes

- **Page shell**: `max-w-6xl mx-auto p-4 space-y-6`.
- **Card**: `rounded-lg border border-zinc-800 bg-zinc-900/40 p-4`; title `text-sm font-semibold text-zinc-300`.
- **Table**: `text-sm whitespace-nowrap`; thead sticky `bg-zinc-950`, header text `zinc-400`;
  row `border-b border-zinc-900 hover:bg-zinc-900`; numeric cells `text-right font-mono tabular-nums text-zinc-300`.
- **Link**: `zinc-300`, hover → `--color-accent`. (Table links stay calm; accent on interaction.)
- **Primary button**: brand bg, white text, `focus-visible` ring in accent.
- **Secondary button**: `border-zinc-700 text-zinc-200 hover:bg-zinc-900`.
- **Badge**: `ring-1 ring-inset` pattern; locked → down-red tint, open → up-green tint.
- **Focus**: global `:focus-visible` 2px `--color-accent` outline (never brand red — a red focus
  ring reads as a validation error).

## Cross-app continuity

- Asset icons `https://cdn.xcp.io/img/icon/{asset}`; full art `/img/full/{asset}`.
- Wallet connect → `window.xcpwallet`; Trade → xcpdex; collections → digirare.
- xcpdex stays green-accented (trading = up/down world); the explorer's sky accent is deliberate
  differentiation within the family: dex = trade, explorer = knowledge.
