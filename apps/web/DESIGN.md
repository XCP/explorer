# xcp.io Explorer — Design Logic

Converged from the three sibling codebases so the explorer feels native in the XCP product family:
- **xcpdex** (`exchange/apps/web`) — dark zinc-950 terminal, Geist mono tables, dense financial data.
- **XCP Wallet extension** (`extension/`) — Headless UI, rounded, focus rings, blue-500 accent, light.
- **Original explorer** (`xcp.io`, Catalyst) — zinc palette, Headless UI, **brand `xcp: #ec1550`**, lock badges.

## Decision
**Base = xcpdex's dark zinc-950 terminal** (explorer + exchange = one family) **+ the `#ec1550` xcp brand
accent** (identity from the original explorer) **+ Headless UI interaction patterns** (continuity with the
extension). Dark-first; light mode is a later add via a `class` strategy.

## Tokens (Tailwind v4 `@theme`)
| Token | Value | Use |
|---|---|---|
| `--color-background` | `#09090b` (zinc-950) | page bg |
| surface | `zinc-900` `#18181b` / `zinc-900/40` | cards, panels, sticky thead |
| border | `zinc-800` `#27272a` | dividers, card/table borders |
| text primary | `zinc-100` `#f4f4f5` | headings, asset names, key values |
| text muted | `zinc-500` `#71717a` | labels, secondary cells, timestamps |
| `--color-xcp` (brand) | `#ec1550` | links, active nav, primary buttons, logo |
| success / up / unlocked | `green-500` `#22c55e` | positive deltas, open dispensers |
| danger / down / locked | `red-500` `#ef4444` | negative deltas, locked badges |
| font sans | Geist Sans | UI text |
| font mono | Geist Mono | **all numbers, quantities, hashes, addresses, block heights** |

## Component recipes (copy-paste)
- **Page shell**: `max-w-6xl mx-auto p-4 space-y-6`, bg `#09090b`.
- **Card/panel**: `rounded-lg border border-zinc-800 bg-zinc-900/40 p-4`; title `text-sm font-semibold text-zinc-300 mb-3`.
- **Table** (the explorer's core — from xcpdex): `w-full text-sm whitespace-nowrap`
  - `thead`: `sticky top-0 bg-zinc-950 z-10`; header `tr`: `text-zinc-500 border-b border-zinc-800`; `th`: `text-left font-normal px-3 py-2` (numeric: `text-right`).
  - body `tr`: `border-b border-zinc-900 hover:bg-zinc-900 transition-colors`.
  - `td`: `px-3 py-2`; numeric/hash cells: `text-right font-mono text-zinc-300`; muted: `text-zinc-500`.
  - primary link cell: `text-zinc-100 font-medium hover:text-[--color-xcp]`.
- **Link**: `text-[--color-xcp] hover:brightness-125` (brand) — replaces the scaffold's sky-400.
- **Primary button** (`color="xcp"`): `bg-[--color-xcp] text-white font-medium rounded px-4 py-2 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[--color-xcp] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`.
- **Secondary button**: `border border-zinc-700 text-zinc-200 rounded px-3 py-1.5 hover:bg-zinc-900`.
- **Badge/pill**: `inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset`; locked → `bg-red-400/10 text-red-400 ring-red-400/20`, unlocked → `bg-green-400/10 text-green-400 ring-green-400/20` (matches Catalyst lock badges, recolored to the dark theme).
- **Delta**: `font-mono` + `text-green-500` / `text-red-500`.
- **Mono everywhere it's data**: addresses, tx hashes, block heights, quantities, prices → `font-mono`.

## Cross-app continuity
- **Asset icons**: `https://cdn.xcp.io/img/icon/{asset}` (square, `rounded`/`rounded-sm`).
- **Wallet connect** button uses the xcp brand + Headless UI button so the handoff to `window.xcpwallet` feels continuous with the extension.
- **Deep-links**: "Trade" → xcpdex; NFT/collection → digirare — styled as secondary buttons/links.
