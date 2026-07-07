# TABLES.md — record-table spec (FINAL)

Synthesized from three inputs: (1) conventions mined from the owner's prior Counterparty UIs,
(2) the unsurfaced-data audit — both preserved verbatim under "Inputs" below — and (3) an
adversarially-verified research survey on dense-table design (2026-07: 25 sources fetched,
25 claims 3-way verified, 20 confirmed / 5 refuted). This document drives the
columns.tsx/cells.tsx rewrite. Read top-down: rules → per-record plan → rollout order.

---

## The rules (final)

> **Owner decision (2026-07-07, supersedes R1's trailing run):** Time is the FIRST column and
> Block the SECOND on every record feed — "information I get out of the glass, then ignore."
> Record feeds are monitoring surfaces, matching the owner's tape/mempool time-first convention;
> the mined explorer trailing-run is retired. Payload-first ordering governs everything after the
> two temporal anchors. View stays at the row end.


Tags: **[mined]** = owner precedent only · **[research: source, confidence]** = verified survey
finding · **[both]**. Where research QUALIFIED a mined rule, the qualification is part of the rule.

**R1. Payload first; fixed trailing run `Status? → Block → relative Time → View`.** Block is never
column 1 unless blocks are the table's subject. [both — mined T1/T4; research: NN/g
importance-ordering ("column order should reflect importance to the user's task, related columns
adjacent") + the bypassing pattern, high. Provenance note: the popular "leftmost column gets the
most fixations" eye-tracking justification was REFUTED in verification (0-3, three separate
claims — those studies cover text pages and comparison tables, not record tables). The rule
stands on importance-ordering and bypassing, not fixation heat.]

**R2. Row anchor = the record's subject.** Asset-bearing rows anchor on icon + linked asset name
(icon ≥24px in anchor position, 16px in secondary asset columns); asset-less rows anchor on
Source; the raw tx list anchors on the hash. [both — mined T2; research: NN/g "first column
should be a human-readable record identifier, not mystery meat", medium. NN/g leaves
canonical-hash identifiers unaddressed — we keep hash-first ONLY on the generic transactions
list, and pair it with a human-readable Type chip (see plan §1).]

**R3. Quantity sits immediately right of its asset** — they read as one phrase
("1,000 PEPECASH"). [both — mined T3; research: NN/g "related columns should be adjacent", high.]

**R4. Contextual suppression: never render the column the page already answers** (asset column on
asset pages, source on address pages, block on block pages), and sign quantities from the page
subject's perspective on address tabs. [both — mined T5; research: the bypassing pattern — "users
deliberately skip the first words when multiple lines start with the same word(s)" — high; a
value repeating down every row is actively ignored and wastes the highest-value real estate.
Corollary from the same finding: avoid uniform leading prefixes inside anchor cells — front-load
the differentiating characters.]

**R5. Addresses render FULL wherever the address is payload.** [both — mined T6; research: USENIX
Security 2025 address-poisoning measurement (~270M attempts, ~$84M confirmed losses) + arXiv
2508.12107, high — the survey's best-evidenced rule: prefix+suffix truncation is precisely the
exploitable gap attackers mint lookalikes against.] Where space genuinely forbids it (dense tapes
only): a LONG prefix+suffix run plus a copy-full affordance — **never 4+4**; our exchange-derived
`6…4` is below the research bar and should lengthen when touched. Labels (curated
`exchange_name`, burn) render as a colored parenthetical after the address.

**R6. Units live in headers (`Price (BTC)`, `Fee Paid (XCP)`), never repeated per cell; headers go
sticky on long tables.** [both — mined T8; research: UNC eye-tracking thesis — column/row
headings absorb ~half of total fixation duration during table search — medium (n=8; treat as
directional; sticky is our extrapolation from "the anchor should never scroll away").]

**R7. Numbers: right-aligned `font-mono tabular-nums`; always the normalized value (divide by 1e8
only when divisible — never render raw satoshi fields); comma-grouped; magnitude-aware precision
≤8dp; trailing zeros stripped; signed % keeps its `+`.** [mined T7 — the research survey produced
NO surviving verified claims on numeric formatting (precision, compaction, decimal alignment);
this stays practitioner convention, marked as such.]

**R8. Green/red are reserved for buy/sell semantics AND must never be hue-only.** [both — mined
T9; research: Bloomberg CVD study — CVD users (~6% of Terminal subscribers, red-green being the
common axis) were measurably more accurate and more confident on alternative palettes — high.]
Concretely: every green/red value carries a non-color channel (the buy/sell word itself, a
`+`/`-` sign, or an arrow); ALL non-semantic table text stays neutral so the semantic hues remain
exclusive; status pills may use green/red because the pill's text label is the redundant channel.
Optional future CVD mode: blue=up/buy, red=down/sell (Bloomberg's scheme).

**R9. Time is relative in table cells** ("3 days ago"; compact `5m`/`3h` on tapes) **with the
absolute UTC in `title`**; absolute timestamps belong only in detail-page KV panels. [mined T4 —
research silent; practitioner convention.]

**R10. Status renders as a colored pill** (`bg-{c}-400/10 text-{c}-400 ring-{c}-400/20`):
open/valid=green, filled=blue, expired/invalid=red, cancelled=gray, pending=yellow,
completed=indigo; dispensers: open=green, open-empty=yellow, closing=orange, closed=red.
[mined T4 — research silent on palettes; text-in-pill satisfies R8's redundant channel.]

**R11. Hover + keyboard-focus row highlighting is the PRIMARY place-keeping mechanism** in our
link-row tables — the only aid that is on-demand and adds zero static ink. Zebra striping is an
optional no-harm default (if adopted: single color, alternating single rows, dark theme = one
slightly lighter surface tone) and never load-bearing. [research: NN/g data-tables, medium;
Enders striping studies (244 participants + 2,276 timed sessions: significant on only 1/6 speed
and 3/8 accuracy questions, never negative), high. Fills a mined gap.]

**R12. No cell flashing, ever, in historical tables.** Explorer records are append-only —
blinking is per-column opt-in and only for genuinely live cells (mempool status, chain tip).
[research: AG Grid, the dominant financial-grid practice — flashing off by default, deliberate
per-column opt-in — high. Fills a mined gap.]

**R13. One consistent column grammar across all record types; strict vertical alignment; one
attribute per column; no prose-shaped cells** (text columns truncate ~50 chars). Structure is the
defense against lossy F-scanning, which appears exactly when structural cues are absent; lookup
users scan DOWN a key column, so optimize column-wise consistency across the 16 types. [both —
mined T12 (shared chrome, per-type columns); research: NN/g F-pattern-is-conditional +
lawn-mower-exception, high. Caution: the lawn-mower row-sweep is comparison-table behavior — do
not cite it for record-table column order.]

**R14. Responsive: prose/secondary columns hide first (`hideBelow`); identity, quantity, and
status never hide.** [mined T11 — research silent.]

**R15. Trading tapes invert the grammar: Time first** (trades, mempool — freshness anchors when
recency is the question or no block exists). [mined T10 — research silent.]

**Areas the research could NOT verify** — no surviving claims; these stay practitioner
convention, marked as such: numeric formatting/precision/compaction (R7), the Tufte/Few/Butterick
typographic canon itself (so "right-aligned tabular numerals" and "units in headers" are only
indirectly evidenced), WCAG floors for dense tables (24px target size, screen-reader semantics of
link-rows, `<th>` scope), and empty/skeleton states. Keep current practice — real `<table>`
markup, `<th>` headers, explicit "No {things} found" empties, adequate row padding — as
convention, not evidence.

---

## Per-record implementation plan

Notation: `⟨run⟩` = trailing run `Status? | Block | Time | View` (R1) — Status only where the
record has state worth showing; Block linked + comma-grouped, suppressed on block pages; Time
relative with UTC `title`; View right-aligned trailing link, `sr-only` header. Cell recipes are
§C below (assetAnchor = ≥24px icon + link; qty = normalized, signed in address context; addr =
full linked mono + optional label; pill = R10; chip = small neutral label — chips are NOT
green/red per R8). Work markers: **(P1)** systemic sweep · **(P2)** returned-but-hidden, cells
only · **(P3)** API/query work — see Rollout.

### 1. transactions
- Columns: `Tx | Type | Source | Destination | ⟨Block | Time | View⟩`
- Add: **Type chip decoded from `data` type byte (P3)** — audit #6; a tx list that can't say what
  each tx is answers nothing. Optional: btc_amount/fee (already returned) at `hideBelow: "xl"`.
- Suppress: Source on address pages; Block on block pages.
- Cells: short-hash mono link (R2's sanctioned exception), chip, addr, addr, ⟨run⟩.

### 2. sends
- Columns: `Asset | Quantity | Type | Source | Destination | ⟨Block | Time | View⟩` (no Status —
  valid-only feed)
- Add: **`send_type` chip (P2)** — audit #10, cheapest item: attach/detach/MPMA/move are
  different actions flattened into "send" today. Later: `memo` (P3, stored not returned).
- Suppress: Asset on asset tab; Source on address tab + sign Quantity.
- Cells: assetAnchor, qty(signed), chip, addr, addr, ⟨run⟩.

### 3. issuances
- Columns: `Asset | Quantity | Action | Issuer | Description | ⟨Status | Block | Time | View⟩`
- Add: **Action badge from `asset_events` (P3)** — audit #5; the mined table's defining column
  (Lock/Reset/Transfer/Issue/Edit/Create) is stored verbatim, one SELECT away. Description
  (already returned) truncated 50 at `hideBelow: "xl"`. Optional: `fee_paid` (P3, mined column).
- Suppress: Asset on asset tab.
- Cells: assetAnchor, qty, action badge (icon+label, per-action accent), addr, text-trunc, pill, ⟨run⟩.

### 4. orders
- Columns: `Pair | Side | Price | Amount | Total | Filled % | Expires | ⟨Status | Block | View⟩`
- Add: **Total = price × amount (P2, derived client-side)**; **Filled % from
  `give_remaining`/`get_remaining` (P3)** and **Expires from `expiration`/`expire_index` (P3)** —
  audit #3, the two live questions about an open order. Maker `source` is returned and unshown —
  add at `hideBelow: "lg"`.
- Suppress: nothing page-equal (Pair ≠ asset page asset — keep but consider suppressing base on
  asset tab).
- Cells: pair link, side (green/red word — R8 satisfied by the word), price (unit → header, R6),
  qty, qty, percent, blocks-left ("~2d" style), pill, ⟨run⟩.

### 5. order_matches → trades-shaped
- Columns: `Pair | Side | Price | Quantity | Total | Buyer | Seller | ⟨Status | Block | Time | View⟩`
- Add: **normalize quantities via the ORDER_SELECT-style divisibility join (P3)** — audit #2 /
  gap-list #1; `tx1_address` is already returned (P2). Pending BTC matches: settle-by from
  `match_expire_index` (P3, optional). DEX matches already exist normalized in `trades` — reuse.
- Suppress: Buyer/Seller when equal to the address page subject.
- Cells: pair link, side, price, qty, qty, addr, addr, pill, ⟨run⟩.

### 6. dispensers
- Columns: `Asset | Price (BTC) | Available | Sales | ⟨Status | Block | View⟩` + Source at
  `hideBelow: "lg"`
- Add: **`status` badge (P2)** — audit #4, on the wire today, hidden entirely; **`operator_trust`
  (P2 on asset tabs — already SELECTed there, rendered nowhere)**. **`escrow_quantity` (P3)**
  completes the mined `remaining / escrow` Available cell; `give_quantity` unit size in `title`;
  `oracle_address` (P3) so oracle-priced machines stop looking free/wrong; `origin` (P3).
- Suppress: Asset on asset tab; Source on address tab.
- Cells: assetAnchor, price (sats mode for dust), combined `remaining / escrow` qty, count,
  dispenser pill (4-state palette), ⟨run⟩.

### 7. dispenses
- Columns: `Asset | Quantity | Price (BTC) | Total (BTC) | Source | Destination | ⟨Block | Time | View⟩`
- Add: **`btc_amount` → Price + Total (P3)** — audit #1, the single largest stored-but-invisible
  field; without it a dispense is indistinguishable from a free send. **USD (P3)** — already
  computed in the `trades` ledger; render as column at `hideBelow: "lg"` or `title`.
  `dispenser_tx_hash` (returned) links the machine — put on the Price cell.
- Suppress: Asset on asset tab; Source/Destination per address tab + sign.
- Cells: assetAnchor, qty, price, total (+USD title), addr, addr, ⟨run⟩.

### 8. sweeps
- Columns: `Source | Destination | Sweep | Fee Paid (XCP) | Memo | ⟨Block | Time | View⟩`
- Add: **`flags` badge (P2)** — balances / ownership / binary-memo, the mined SweepFlagsBadge,
  zero backend work; **`fee_paid` (P2)**. Memo demoted to `hideBelow: "xl"`.
- Suppress: Source on address tab.
- Cells: addr, addr, flags badge, qty, text-trunc, ⟨run⟩.

### 9. broadcasts
- Columns: `Source | Text | Value | ⟨Block | Time | View⟩`
- Add: **`locked` badge + oracle attribution (P2 locked / P3 oracle)** — separates dead feeds and
  price oracles from graffiti. Text truncated ~50, never hidden below Value: Value gets
  `hideBelow: "xl"` (invert today's mistake).
- Suppress: Source on address tab.
- Cells: addr (+oracle/locked chip), text-trunc, numeric, ⟨run⟩.

### 10. burns
- Columns: `Source | Burned (BTC) | Earned (XCP) | USD | ⟨Block | Time | View⟩`
- Add: **USD-at-burn via `prices` (P3)** — turns a 2014 curiosity into "paid $X for its XCP";
  column or `title`.
- Suppress: Source on address tab.
- Cells: addr, qty, qty, usd, ⟨run⟩.

### 11. dividends
- Columns: `Asset | Dividend | Per Unit | Recipients | Source | ⟨Block | Time | View⟩`
- Add: **`fee_paid` → Recipients (P3)** — the protocol fee counts holders paid
  (fee_paid / 20000 sat); "how many got paid" is the dividend question.
- Suppress: Asset on asset tab; Source on address tab.
- Cells: assetAnchor, asset link (16px icon), qty (unit = dividend_asset, header note), count,
  addr, ⟨run⟩.

### 12. bets
- Columns: `Source | Type | Wager (XCP) | Counterwager (XCP) | Target | Expiration | ⟨Status | Block | View⟩`
- Add: **`bet_type` + `counterwager_quantity` (P2)** — both returned; type and odds are what a
  bet is. `target_value`, `deadline` returned too. **Fix: wager renders raw satoshis — normalize
  (P2, R7 bug).** Feed address `hideBelow: "md"`.
- Suppress: Source on address tab.
- Cells: addr, bet-type badge (Bullish/Bearish CFD, Equal/NotEqual), qty, qty, numeric, blocks,
  pill, ⟨run⟩.

### 13. fairminters
- Columns: `Asset | Price (XCP) | Minted % | Hard Cap | ⟨Status | Block | View⟩` + Source at
  `hideBelow: "lg"`
- Add: **Minted % = `earned_quantity` / `hard_cap` (P2)** — audit #9, both operands on the wire;
  one cell turns a config dump into a progress table. Later: window state from
  `start_block`/`end_block` (P3), `burn_payment` (P3 — changes what "price" means).
- Suppress: Asset on asset tab.
- Cells: assetAnchor, price (unit → header, R6), percent (progress), qty, pill, ⟨run⟩.

### 14. fairmints
- Columns: `Asset | Earned | Paid (XCP) | Source | ⟨Block | Time | View⟩`
- Add: **`paid_quantity` (P2)** — free-mint vs paid-mint is the row's one interesting split.
  **Fix: `earn_quantity` renders raw — normalize (P2, R7 bug).**
- Suppress: Asset on asset tab; Source on address tab.
- Cells: assetAnchor, qty, qty, addr, ⟨run⟩.

### 15. destructions
- Columns: `Asset | Quantity | Tag | Source | ⟨Block | Time | View⟩`
- Add: nothing — leanest table in the mirror; just the P1 reorder + Time. Tag stays at
  `hideBelow: "md"`.
- Suppress: Asset on asset tab; Source on address tab + sign.
- Cells: assetAnchor, qty(signed), text-trunc, addr, ⟨run⟩.

### 16. btcpays
- Columns: `Source | Destination | BTC | Order Match | ⟨Block | Time | View⟩`
- Add: **link `order_match_id` (P2)** — already returned; a btcpay without its match is a
  context-free BTC transfer. Later: resolve to pair/price of the settled trade (P3).
- Suppress: Source/Destination on address tab.
- Cells: addr, addr, qty, match link, ⟨run⟩.

### Non-registry tables
- **trades** (tape, Time-first per R15): add **unit `price` + `seller` (P2)** — both returned;
  **self-trade dim via `asset_signals.self_trade_pct`/`low_quality` + buyer=seller flag (P3)** —
  audit #8. Keep compact time.
- **holders**: add **% of supply + rank (P2)** — denominator already on the page — audit #7;
  later `updated_block_index` "last moved" + curated `exchange_name` labels (P3).
- **blocks**: Block-first is correct (blocks are the subject); complete. Optional: interval Δ
  client-side.
- **mempool**: Time-first, conforms (R15). The one place cell flashing may ever be enabled (R12).

---

## Rollout order

### Pass 1 — systemic (one sweep of registry/columns.tsx + cells.tsx + record-table.tsx + ui/table.tsx)
1. **Reorder all 16 kinds payload-first + append the trailing run** `Status? | Block | Time | View`
   (R1): Block linked/comma-grouped/moved to run; View as right-aligned trailing link with
   `sr-only` header.
2. **Relative-time cell** — new `timeAgo` cell with absolute UTC in `title` (R9); registry rows
   gain Time where missing (block_time is already returned on nearly every kind).
3. **Status pill component** + palette (R10) — replaces bare status text everywhere; includes the
   4-state dispenser variant.
4. **Contextual suppression** — `context` knob on `Col`/`RecordTable`
   (`{ address?, asset?, block? }`) driving column drop + quantity signing (R4); `detail-tabs.tsx`
   passes page context.
5. **Hover + focus-visible row highlight** in `ui/table.tsx` (R11); zebra optional/no-harm.
6. **Units out of cells into headers** (R6): orders Price, dispenser price/sats.
7. **Anchor asset cells at ≥24px icon** (16px stays for secondary asset columns) (R2).
8. Confirm the non-rules: no cell flashing anywhere (R12); full addresses stay (R5); non-semantic
   text neutral, green/red only on side/status-with-label (R8).

### Pass 2 — per-type payload fixes (returned-but-hidden; columns + cells only), impact order
1. dispensers: `status` pill + `operator_trust` (audit #4)
2. holders: % of supply + rank (audit #7)
3. trades: unit `price` + `seller` columns (audit #8)
4. fairminters: Minted % (audit #9)
5. sends: `send_type` chip (audit #10)
6. bets: `bet_type` + counterwager + target + deadline; fix raw-sats wager (gap #6)
7. sweeps: `flags` badge + `fee_paid` (gap #7)
8. broadcasts: Text before Value, Value `hideBelow: "xl"`, `locked` badge (gap #9)
9. fairmints: `paid_quantity`; fix raw `earn_quantity` (gap #11)
10. btcpays: `order_match_id` link
11. orders: Total (derived) + maker `source` at `hideBelow: "lg"`
12. issuances: `description` truncated at `hideBelow: "xl"`

### Pass 3 — API additions (stored-not-returned fields or new joins), audit-ranked
1. dispenses: SELECT `btc_amount` → Price (BTC) / Total (BTC) / USD (audit #1 — largest gap)
2. order_matches: divisibility join → normalized Price/Quantity/Total trade view (audit #2)
3. orders: SELECT `give_remaining`/`get_remaining` + `expiration`/`expire_index` → Filled % +
   Expires (audit #3)
4. issuances: SELECT `asset_events` → Action badge (audit #5)
5. transactions: decode `data` type byte → Type chip (audit #6)
6. dispensers: `escrow_quantity` (Available = remaining/escrow), `oracle_address`, `origin`
7. dividends: `fee_paid` → Recipients
8. burns: USD-at-burn via `prices`
9. trades/holders polish: self-trade dim via `asset_signals`; `updated_block_index` "last moved";
   curated `exchange_name` labels on every addrCell
10. cross-cutting: `prices` day-lookup USD `title`s on dispenser prices, order totals, fairmint
    payments

---

# Inputs (source material — preserved verbatim)

## Input 1 — mined conventions from the owner's prior Counterparty UIs

Sources mined (cloned at HEAD, 2026-07-07):

- **nuxt-xcp** (`XCP/nuxt-xcp`) — the most recent *explorer*. One hand-tuned Vue table per message
  type under `components/<type>/<Type>Table.vue` (sends, orders, dispensers, dispenses, issuances,
  broadcasts, sweeps, burns, dividends, bets, destructions, cancels, credits/debits, transactions,
  mempool, …). This is the message-by-message layout record.
- **XCP/exchange** — the newest work (Next.js DEX, June 2026). Dense trading tables:
  `apps/web/src/components/trades-list.tsx`, `markets-table.tsx`, `holders-table.tsx`, plus
  `utils/format-amount.ts`, `format-price.ts`, `format-address.ts`.
- **xcpdex.com** (`droplister/xcpdex.com`, Laravel/Vue 2019) — the original DEX explorer:
  `resources/assets/js/components/Orders.vue`, `OrderMatches.vue`, `MarketOrders.vue`,
  `MarketOrderMatches.vue`, `Blocks.vue`.

Audited against: `apps/web/src/lib/registry.tsx` (column defs), `apps/web/src/lib/cells.tsx`,
`apps/web/src/components/record-table.tsx`, `apps/web/src/components/ui/table.tsx`,
`apps/web/src/lib/format.ts`.

---

### A. Touchstones — the cross-table invariants

These held across *every* explorer table in nuxt-xcp and (where applicable) both DEX repos.

### T1. The payload leads; block/time trail. Block is never the first column.

Every nuxt-xcp message table opens with the message's *subject* and closes with the locator run
`Status → Block # → Time → View`. Header orders, verbatim from `components/*/…Table.vue`:

```
sends:         Asset | Quantity | Source | Destination | Status | Block # | Time | [View]
dispenses:     Asset | Dispensed | Price (BTC) | Total (BTC) | Source | Destination | Block # | Time | [View]
dispensers:    Asset | Price (BTC) | Dispenses | Available | Status | Block # | Time | [View]
issuances:     Asset | Quantity | Source | Description | Action | Fee Paid (XCP) | Status | Block # | Time | [View]
broadcasts:    Source | Text | Value | Fee | Status | Block # | Time | [View]
burns:         Source | Burned (BTC) | Earned (XCP) | Status | Block # | Time | [View]
sweeps:        Source | Destination | Sweep | Fee Paid (XCP) | Status | Block # | Time | [View]
dividends:     Source | Asset | Dividend | Quantity Per Unit | Fee Paid (XCP) | Status | Block # | Time | [View]
bets:          Source | Bet | Wager (XCP) | Counterwager (XCP) | Target Value | Leverage | Expiration | Status | Block # | Time
destructions:  Asset | Quantity | Source | Status | Time | [View]
orders:        Selling | Quantity | Buying | Quantity | Status | Block # | Time | [View]
transactions:  TX Hash | TX Index | Source | Block # | Time | [View]
```

Block height is a *locator*, not the story. It sits with Time at the row end, linked and
comma-grouped (`block_index.toLocaleString()`, every table).

**Ours today:** every registry table leads with `cBlock`. Systemic inversion of the mined rule.

### T2. Row anchor: asset-bearing messages anchor on the asset (icon + linked name); everything else anchors on Source; a raw tx list anchors on the hash.

nuxt-xcp anchor cell (identical in sends/orders/dispensers/dispenses/issuances/destructions):

```html
<!-- nuxt-xcp components/sends/SendsTable.vue lines 65–80 -->
<td class="whitespace-nowrap py-3 pr-3 min-w-64">
  <div class="flex items-center gap-x-4">
    <NuxtImg :src="`https://app.xcp.io/img/icon/${formatAssetName(send.asset, send.asset_info)}`"
             class="h-10 w-10" loading="lazy" />
    <NuxtLink :to="`/asset/${send.asset}`" class="font-medium … text-white">
      {{ formatAssetName(send.asset, send.asset_info) }}
    </NuxtLink>
  </div>
</td>
```

A **40px icon** (`h-10 w-10`) with `min-w-64` — the icon *is* the row identity, big enough to
recognize art at a glance. Messages with no asset subject (broadcasts, burns, sweeps, bets,
cancels) lead with Source instead. Transactions lead with the hash.

**Ours today:** asset cells use a 16px icon (`cells.tsx assetCell`, `AssetIcon size={16}`), and the
asset never sits first.

### T3. Quantity is glued to its asset — column 2, right after the anchor.

Asset + quantity read as one phrase ("1,000 PEPECASH"). Every asset-anchored nuxt table does
`Asset | Quantity | …`. In xcpdex.com the pairing is even done inline in a single cell:

```html
<!-- xcpdex.com resources/assets/js/components/Orders.vue line 18 -->
<td>{{ order.quantity }} <a :href="'/market/' + order.market_slug">{{ order.base_asset }}</a></td>
```

### T4. Trailing meta run has a fixed order: Status → Block # → Time → View.

- **Status** is a colored pill (`components/ui/badges/StatusBadge.vue`): open=green, filled=blue,
  expired/invalid=red, cancelled=gray, pending=yellow, completed=indigo — all in the
  `bg-{c}-400/10 text-{c}-400 ring-{c}-400/20` recipe. Dispensers get their own badge
  (`DispenserStatusBadge.vue`): 0 open=green, 1 open-empty=yellow, 10 closed=red, 11 closing=orange.
- **Time** is *relative* ("3 days ago"), via `utils/formatTimeAgo.js`
  (`formatDistanceToNow` with "about/almost/over" stripped). Absolute timestamps
  (`formatTimestamp.js`) are reserved for detail-page KV panels, never table cells.
- **View** is a right-aligned trailing link to `/tx/<hash>` with an `sr-only` header — the row's
  single action, always last (`class="… text-right h-16"><NuxtLink … class="text-primary">View`).

**Ours today:** Time is absolute UTC (`format.ts ts()` → `2026-07-06 12:34:56Z`) and sits second;
Tx renders as a shortened hash in varying middle/end positions; Status floats mid-row.

### T5. Contextual column suppression: never show a column the page already answers.

Every nuxt-xcp table takes `address` / `assetName` / `blockIndex` props and drops the redundant
column with `v-if`:

```html
<!-- nuxt-xcp components/sends/SendsTable.vue -->
<th v-if="!props.address" …>Source</th>     <!-- on an address page, source is the page -->
<th v-if="!props.blockIndex" …>Block #</th> <!-- on a block page, block is the page -->
```

On an address page the sends table even signs the quantity from the address's perspective:
`{{ props.address ? '-' : '' }}{{ send.quantity_normalized }}` (line 82).

**Ours today:** `detail-tabs.tsx` reuses the same registry cols on address/asset/block pages —
an asset's Sends tab shows the asset in every row; the address page shows the address in every row.
`RecordTable`/`Col` has no context mechanism.

### T6. Addresses are FULL in explorer tables; truncation is a trading-tape concession.

nuxt-xcp renders complete addresses, linked, and lets the table scroll
(`TableTemplate.vue`: wrapper `overflow-x-auto`, table `whitespace-nowrap`). Only the
ultra-dense exchange tape truncates, and then symmetrically:

```ts
// XCP/exchange apps/web/src/utils/format-address.ts
if (address.length <= 10) return address
return `${address.slice(0, 6)}...${address.slice(-4)}`
```

**Ours today:** `addrCell` renders full addresses in mono — matches. Keep.

### T7. Numbers: right-aligned, mono, tabular; magnitude-aware precision; strip trailing zeros.

From the newest repo (XCP/exchange `markets-table.tsx`, `trades-list.tsx`):
`text-right … font-mono` on every numeric cell, identity cells left-aligned. Precision rules
(`utils/format-amount.ts`): ≥1K compact/comma-grouped; <1 shows 4→6→8 decimals by first
significant digit, then `.replace(/\.?0+$/, '')`. Prices (`format-price.ts`) hold 8dp for BTC and
have a sats mode. nuxt-xcp's `formatBalance` divides by 1e8 only when `divisible`, comma-groups the
integer part.

**Ours today:** `Cell numeric` → `text-right font-mono tabular-nums` — matches. `commas()` caps at
8dp — matches. Keep.

### T8. Units live in the header, not repeated per cell.

`Wager (XCP)`, `Burned (BTC)`, `Earned (XCP)`, `Fee Paid (XCP)`, `Price (BTC)`, `Total (BTC)` —
nuxt-xcp headers everywhere. The cell holds only the number.

**Ours today:** mixed — burns does this (`Burned (BTC)`), but Order `Price` renders
`0.0021 XCP` per cell and dispenser price renders `… BTC`/`… sats` per cell.

### T9. Buy/sell coloring: buy/long = green, sell/short = red. Signed % keeps its `+`.

```html
<!-- xcpdex.com OrderMatches.vue line 19 -->
<td :class="match.type === 'Buy' ? 'text-success' : 'text-danger'">{{ match.type }}</td>
```
```tsx
// XCP/exchange trades-list.tsx line 93
<td className={`… ${trade.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
```

**Ours today:** `registry.tsx side()` — matches. Keep.

### T10. Trading surfaces invert the grammar: Time first.

A tape is freshness-first. XCP/exchange `trades-list.tsx`:
`Time | Type | Price | {base} | {quote} | Taker | Maker | [tx →]` with compact time (`5m`, `3h`);
xcpdex.com `OrderMatches.vue`: `Date | Side | Quantity | Price | Total | Buyer | Seller`. Same for
mempool (nuxt `MempoolTable.vue`: `Time | Type | Source | Asset | Summary | TX Hash`) — unconfirmed
rows have no block, so recency anchors.

**Ours today:** `components/trades.tsx TRADE_COLS` and `mempool-feed.tsx` lead with Time — matches.

### T11. Responsive: drop the prose columns first, keep identity + key metric.

nuxt-xcp hides long-text/secondary columns below xl (`hidden xl:table-cell` on issuance
Description, broadcast Value/Fee); exchange uses `max-sm:hidden` on Vol/Trades/Taker/Maker.
Identity, quantity, and status never hide.

**Ours today:** `hideBelow` implements exactly this — matches. Keep (audit which columns carry it).

### T12. Shared chrome, per-type columns.

nuxt-xcp enforces consistency with one `components/ui/TableTemplate.vue` (pagination, loading
spinner, error and "No {things} found" empties, aria-live, column-count colspan) while each message
type owns its `<th>`/`<td>` slots. Our `RecordTable` + typed `Col<RecordRowMap[K]>` registry is the
stronger version of the same idea — the gap is only that our shared layer lacks T4's trailing-run
convention and T5's context suppression.

---

### B. Per-record layouts (our 16 registry kinds)

Legend: **[move]** wrong position · **[miss]** column the mined spec has and we lack ·
**[noise]** column the mined spec deliberately omits or demotes.

### 1. transactions
- Current: `Block | Time | Tx | Source | Destination`
- Spec (nuxt `TransactionsTable.vue`: `TX Hash | TX Index | Source | Block # | Time`):
  **`Tx | Source | Destination | Block | Time`**
- The hash is the row's identity — it leads **[move: Tx to 1st, Block/Time to end]**. nuxt also
  showed `TX Index` (protocol ordinal); optional for us.

### 2. sends
- Current: `Block | Asset | Quantity | Source | Destination | Tx`
- Spec (nuxt `SendsTable.vue`): **`Asset | Quantity | Source | Destination | Block | Time | Tx`**
- **[move: Block to end]** **[miss: Time]**. Status omitted is fine for a valid-only feed. On the
  address tab: drop Source, sign the quantity (T5).

### 3. issuances
- Current: `Block | Asset | Quantity | Issuer | Status | Tx`
- Spec (nuxt `IssuancesTable.vue`): **`Asset | Quantity | Action | Issuer | Status | Block | Time | Tx`**
- **[miss: Action]** — the mined table's defining column: derived icons+labels for what the
  issuance *did* — `Lock` (green padlock), `Reset` (blue), `Transfer` (purple), `Issue` (orange
  `quantity > 0`), `Edit` (description changed), `Create` (first issuance) — see
  `IssuancesTable.vue` lines 116–178. An issuance row is about what changed, not the quantity.
  Description column optional at `hideBelow: "lg"` (mined: `hidden xl:table-cell`, truncated to 50).

### 4. orders
- Current: `Block | Pair | Side | Price | Amount | Status | Tx`
- Spec (xcpdex `Orders.vue`: `Side | Quantity | Price | Total | Blocks Left | Source`; nuxt used raw
  `Selling | Qty | Buying | Qty`): **`Pair | Side | Price | Amount | Total | Expires | Status | Block | Tx`**
- Our market-view (pair/side/price) is the owner's *DEX* grammar — keep it over nuxt's raw give/get.
  **[move: Block to end]** **[miss: Total (quote), Blocks Left/Expires]** — an open order's
  remaining life was a first-class column in xcpdex.com.

### 5. order_matches — furthest from spec
- Current: `Block | Forward | Backward | Status | Party A`
- Spec (xcpdex `OrderMatches.vue`): **`Pair | Side | Price | Quantity | Total | Buyer | Seller | Block | Time`**
- Ours is a raw mirror dump: forward/backward assets with no price, no quantities, no time, only
  one party, and the row *ends* on Party A **[miss: Price, Quantity, Total, Seller, Time]**
  **[noise: bare Forward/Backward columns — the mined table always resolves matches into a market
  view]**. A match is a trade; render it like one (we already have `orderView` for orders).

### 6. dispensers
- Current: `Block | Asset | Price | Remaining | Sales | Source | Tx`
- Spec (nuxt `DispensersTable.vue`): **`Asset | Price (BTC) | Sales | Available | Status | Source | Block | Tx`**
- **[miss: Status]** — mined has `DispenserStatusBadge` (open/empty/closing/closed) *and* a status
  filter dropdown; a dispenser list without state is half a table. Mined "Available" is the neat
  `give_remaining / escrow_quantity` combined cell (`{{ …remaining }} / {{ …escrow }}`), richer than
  our bare Remaining. **[move: Block to end]**.

### 7. dispenses
- Current: `Block | Asset | Quantity | Source | Destination | Tx`
- Spec (nuxt `DispensesTable.vue`): **`Asset | Quantity | Price (BTC) | Total (BTC) | Source | Destination | Block | Time | Tx`**
- **[miss: Price and Total]** — the mined table computes BTC paid per row
  (`calculateBTCPaid(dispense_quantity, give_quantity, satoshirate)`, lines 206–209). A dispense is
  a *sale*; without price/total it's just a send. Biggest per-type content gap after order_matches.

### 8. sweeps
- Current: `Block | Source | Destination | Memo | Tx`
- Spec (nuxt `SweepsTable.vue`): **`Source | Destination | Sweep | Fee Paid (XCP) | Block | Time | Tx`**
- **[miss: Sweep flags]** — mined renders `SweepFlagsBadge` (balances / ownership / memo-is-hex
  decode) — *what got swept* is the payload. Memo stays but demoted. **[move: Block to end]**.

### 9. broadcasts
- Current: `Block | Source | Value | Text | Tx`
- Spec (nuxt `BroadcastsTable.vue`): **`Source | Text | Value | Block | Time | Tx`**
- A broadcast is "who said what": Source then Text (truncated ~50 chars, `formatDescription`),
  Value/Fee hidden below xl **[move: Text before Value; Block to end]**. Our Text at
  `hideBelow: "sm"` hides the payload on mobile — invert: hide Value first.

### 10. burns
- Current: `Block | Source | Burned (BTC) | Earned (XCP) | Tx`
- Spec (nuxt `BurnsTable.vue`): **`Source | Burned (BTC) | Earned (XCP) | Block | Time | Tx`**
- Closest table to spec — just **[move: Block to end]** **[miss: Time]**. Header units already right.

### 11. dividends
- Current: `Block | Asset | Dividend | Per Unit | Source | Tx`
- Spec (nuxt `DividendsTable.vue`: `Source | Asset | Dividend | Quantity Per Unit | Fee Paid (XCP) | Status | Block | Time`):
  **`Asset | Dividend | Per Unit | Source | Block | Time | Tx`**
- Our column *set* is right (mined even led with Source here — the payer matters — but keeping the
  asset anchor is consistent with T2). **[move: Block to end]** **[miss: Time]**. Label the unit:
  `Per Unit` cell is in dividend_asset units.

### 12. bets
- Current: `Block | Source | Feed | Wager | Status | Tx`
- Spec (nuxt `BetsTable.vue`): **`Source | Type | Wager (XCP) | Counterwager (XCP) | Target | Expiration | Status | Block | Tx`**
- **[miss: Bet type]** (`BetTypeBadge` / `formatBetType`: Bullish CFD / Bearish CFD / Equal /
  NotEqual), **[miss: Counterwager, Expiration]** — odds and lifetime are what a bet row is.
  Mined shows XCP-normalized wagers via `formatBalance(bet.wager_quantity, { divisible: true })`;
  ours renders raw `wager_quantity` satoshis **(formatting bug by mined standards)**. Feed address
  can stay but hidden below md (mined omitted it entirely).

### 13. fairminters (no mined precedent — apply the grammar)
- Current: `Block | Asset | Price | Hard Cap | Status | Source`
- Spec: **`Asset | Price (XCP) | Hard Cap | Minted %? | Status | Source | Block`**
- Column set is reasonable; **[move: Block to end]**; unit into header (T8). Row currently ends on
  Source with no locator after it.

### 14. fairmints
- Current: `Block | Asset | Earned | Source | Tx`
- Spec: **`Asset | Earned | Paid (XCP)? | Source | Block | Time | Tx`**
- **[move: Block to end]**. `commas(r.earn_quantity)` renders raw units — needs the normalized
  value (same class of bug as bets wager).

### 15. destructions
- Current: `Block | Asset | Quantity | Tag | Source | Tx`
- Spec (nuxt `DestructionsTable.vue`: `Asset | Quantity | Source | Status | Time`):
  **`Asset | Quantity | Tag | Source | Block | Time | Tx`**
- Set is right (Tag is our addition; fine at `hideBelow: "md"`). **[move: Block to end]**.

### 16. btcpays (no mined table — apply the grammar)
- Current: `Block | Source | Destination | BTC | Tx`
- Spec: **`Source | Destination | BTC | Order Match? | Block | Time | Tx`**
- No asset subject → Source anchors (T2). A btcpay settles a match; linking `order_match_id` would
  give the row its story. **[move: Block to end]**.

Non-registry tables checked: `trades.tsx` (Time-first tape — conforms to T10),
`mempool-feed.tsx` (Time-first — conforms), `blocks-list.tsx` (Block-first is *correct* here: the
block is the subject; nuxt `BlocksTable.vue` and xcpdex `Blocks.vue` both lead with Block #),
`app/block/[n]/page.tsx` tx list (Tx-first — conforms to T1).

---

### C. Cell recipes

**Asset** — linked to `/asset/`, icon + display name where display name = `asset_longname ?? asset`
(nuxt `utils/formatAssetName.js`; XCP/BTC never get longnames). Icon from
`https://app.xcp.io/img/icon/<name>`, mined at 40px as the row anchor (ours: 16px — consider ≥24px
for anchor position, 16px for secondary asset columns like Dividend). `weight: "primary"`.

**Quantity** — always the `_normalized` value (divide by 1e8 only when divisible —
`formatBalance`), comma-grouped, ≤8dp, trailing zeros stripped (exchange `format-amount.ts`),
right-aligned `font-mono tabular-nums`. Never render raw satoshi fields (bets, fairmints today).
Sign from the page-subject's perspective on address tabs (`props.address ? '-' : ''`).

**Price** — unit in the header (`Price (BTC)`), 8dp for BTC (`toFixed(8)`, exchange
`format-price.ts`), sats mode for dust (< 0.0001 BTC → `12,345 sats`; our `btcPrice` matches the
exchange sats-mode idea). XCP prices: 4dp above 1, `toPrecision(3)` below (our `fmtPrice`).

**Address** — full string, `font-mono`, linked to `/address/`. Truncate to `6…4`
(`format-address.ts`) only in dense tapes or where a label accompanies it. Labels/tags render as a
colored parenthetical after the address (exchange `holders-table.tsx`: `(Burn)` yellow, other tags
blue).

**Block** — linked to `/block/`, comma-grouped, numeric-right. Position: last-run, immediately
before Time (T1/T4); first only when blocks are the table's subject. Suppressed on block pages.

**Time** — relative, terse, penultimate (or first on tapes/mempool). Long form "3 days ago"
(`formatTimeAgo`, date-fns with about/over/almost stripped) for explorer tables; compact `5m`/`3h`
(exchange `compactTime`) for tapes. Absolute UTC belongs in detail KV panels only. Put the absolute
in a `title` attribute.

**Txid** — the row's trailing action, right-aligned, last column, `sr-only` header. Mined renders
the literal link "View" in the accent color; a shortened mono hash (`8…6`) is an acceptable
substitute but keep it last.

**Status** — pill, `bg-{c}-400/10 text-{c}-400 ring-{c}-400/20`: open=green, filled=blue,
expired=red, cancelled=gray, pending=yellow, completed=indigo, valid=green, invalid(+`invalid:*`)=red;
dispensers: open=green, open-empty=yellow, closing=orange, closed=red. Ours renders bare status
text — no pill, no color.

**Side** — `buy`=green-400 / `sell`=red-400 text (no pill). Signed percentages keep the explicit `+`.

---

### D. Gap list — ranked by distance from spec

1. **order_matches** — wrong genre entirely: raw forward/backward dump, no price/quantity/total,
   one party, no time; row ends mid-thought. Needs the xcpdex trade-view rebuild.
2. **Systemic: block-first everywhere + absolute-UTC Time + no trailing View/Tx convention** —
   every registry table violates T1/T4 at once; one registry pass fixes all 16.
3. **dispenses** — missing Price (BTC) and Total (BTC); currently indistinguishable from sends.
4. **No contextual suppression (T5)** — asset tabs repeat the asset 50×, address tabs repeat the
   address; `Col`/`RecordTable` needs a context knob (and quantity signing on address pages).
5. **issuances** — missing the Action column (lock/reset/transfer/issue/edit/create), the mined
   table's whole point.
6. **bets** — missing type/counterwager/expiration; wager rendered in raw satoshis.
7. **sweeps** — missing the flags badge (balances vs ownership); memo is standing in for payload.
8. **Status as plain text** — no pill/color system anywhere in the registry (mined had a complete
   palette, incl. dispenser states — which are absent entirely from our dispensers table).
9. **broadcasts** — Text demoted below Value and hidden at `sm`; mined leads Source→Text.
10. **orders** — no Total, no expiration/blocks-left.
11. **fairmints** — raw `earn_quantity`; **transactions** — hash buried third; both quick fixes.
12. **Minor polish** — 16px anchor icons (mined: 40px), units in cells instead of headers
    (T8), relative-time absent from list rows.

---

## Input 2 — unsurfaced data audit (2026-07-07)

What we HAVE but don't SHOW, per record type. Four buckets per table:

- **Displayed** — columns in the registry/component today.
- **Returned, hidden** — on the wire (queries/records.ts SELECT + @xcp/shared row) but no column
  renders it. Zero-backend-work additions.
- **Stored, not returned** — in D1 (migrations 0002/0003/0004/0006/0007/0009) but not SELECTed.
  One-line SELECT + wire-type additions.
- **Derivable** — absent from the row but we already run the machinery elsewhere: the `prices`
  day×currency USD calendar (BTC/ETH/XCP daily, indexer/prices.ts), `asset_signals`
  (quality tier, `low_quality`, `self_trade_pct`, `graph_trust`), `address_signals`
  (`is_exchange`/`is_burn`/`is_deposit`/`is_emblem_vault`/`likely_service`, `disp_trust`),
  `curated` (`exchange_name` operator labels), `dispenser_refills`, `cancels`, `btcpays`,
  mempool pending reads.

Verdict criterion: does it answer the question a reader of THAT table is actually asking?

### transactions
| | |
|---|---|
| Displayed | block_index, block_time, tx_hash, source, destination |
| Returned, hidden | tx_index, btc_amount, fee, supported |
| Stored, not returned | `data` (the raw message payload), `utxos_info` |
| Derivable | message-type chip decoded from `data` (type byte → send/order/issuance/…); address labels via curated |
| **Verdict** | **A message-type column from `data`** — a tx list that can't say what each tx *is* answers nothing; the payload is sitting in the mirror. |

### sends
| | |
|---|---|
| Displayed | block_index, asset, quantity_normalized, source, destination, tx_hash |
| Returned, hidden | block_time, `send_type` (send / enhanced_send / **mpma / attach / detach / move**), status |
| Stored, not returned | `memo`, `memo_hex`, `fee_paid` (attach XCP gas), `source_address`/`destination_address` (UTXO↔address provenance), msg_index, tx_index |
| Derivable | curated `exchange_name` label on either endpoint; is_exchange/is_burn badges; asset quality tier / low_quality dimming |
| **Verdict** | **`send_type` chip** — already on the wire; a UTXO `attach` and a plain send are different stories rendered identically today. Memo close second. |

### sweeps
| | |
|---|---|
| Displayed | block_index, source, destination, memo, tx_hash |
| Returned, hidden | block_time, **`flags`** (1=balances, 2=ownership, 4=binary memo — the payload §B.8 wants), `fee_paid` (XCP), status |
| Stored, not returned | — (all columns returned) |
| Derivable | swept-asset count (balances at block — heavy; skip), address labels |
| **Verdict** | **`flags` badge** — the mined SweepFlagsBadge needs zero backend work; it's already in SweepRow. |

### dispenses
| | |
|---|---|
| Displayed | block_index, asset, dispense_quantity_normalized, source, destination, tx_hash |
| Returned, hidden | block_time, `dispenser_tx_hash` (link to the machine that sold) |
| Stored, not returned | **`btc_amount`** (BTC the buyer actually paid — §B.7's missing Price/Total), `dispense_index` |
| Derivable | **USD via `prices`** — dispenses are already rows in the `trades` ledger *with `usd_value` filled*; per-unit BTC price = btc_amount/quantity; buyer labels; repeat-buyer flag |
| **Verdict** | **`btc_amount` → Price (BTC) + Total + USD** — the single largest stored-but-invisible field anywhere; without it a dispense is indistinguishable from a free send, and the USD is *already computed* in `trades`. |

### orders
| | |
|---|---|
| Displayed | block_index, pair, side, price, amount, status, tx_hash |
| Returned, hidden | block_time, `source` (the maker — no party shown at all today) |
| Stored, not returned | **`give_remaining`/`get_remaining`** (fill progress), **`expiration` + `expire_index`** (blocks left — first-class in xcpdex), `fee_required`/`fee_provided` (+`_remaining`), `closed_block_index` |
| Derivable | Total (quote) = price × amount from returned fields; Filled % = 1 − remaining/quantity; Expires-in = expire_index − tip; USD via `prices`; cancel provenance via `cancels.offer_hash` |
| **Verdict** | **`give_remaining`/`get_remaining` → Filled %, and `expire_index` → Expires** — an open order's two live questions (how much is left? how long?) are both in D1 and neither is SELECTed. |

### order_matches
| | |
|---|---|
| Displayed | block_index, forward_asset, backward_asset, status, tx0_address |
| Returned, hidden | `tx1_address` (the other party), `forward_quantity`/`backward_quantity` (raw — unusable without divisibility), tx0_hash/tx1_hash, block_time, id |
| Stored, not returned | `match_expire_index`, `fee_paid`, tx0/tx1_index, tx0/tx1_block_index, tx0/tx1_expiration |
| Derivable | Price/Quantity/Total via the ORDER_SELECT-style divisibility join (machinery exists in queries/records.ts); USD via `prices`; BTC-match settlement state via `btcpays.order_match_id`; DEX matches are already normalized rows in `trades` |
| **Verdict** | **Normalize the quantities and render the trade view** (§D.1) — everything needed is returned or one join away; `pending` BTC matches could even show settle-by (`match_expire_index`). |

### dispensers
| | |
|---|---|
| Displayed | block_index, asset, satoshirate_normalized, give_remaining_normalized, dispense_count, source, tx_hash |
| Returned, hidden | block_time, `give_quantity_normalized` (unit size — "sells in lots of N"), **`status`** (0 open / 10 closed / 11 closing — hidden entirely, §B.6's top miss), **`operator_trust`** (already SELECTed on /v2/assets/:a/dispensers — rendered nowhere) |
| Stored, not returned | **`escrow_quantity`** (the mined `remaining / escrow` combined cell), `origin` (true creator when source is an empty vending address), **`oracle_address`** (oracle-priced dispensers look free/wrong without it), `closed_block_index`, `last_status_tx_hash` |
| Derivable | USD price via `prices` (satoshirate × BTC/USD); refill history via `dispenser_refills`; operator label via curated |
| **Verdict** | **`status` badge + the already-returned `operator_trust`** — state and operator track record are the two "should I buy from this machine?" answers; both are on the wire today (status globally, trust on the asset tab). |

### btcpays
| | |
|---|---|
| Displayed | block_index, source, destination, btc_amount_normalized, tx_hash |
| Returned, hidden | **`order_match_id`** (the match this payment settles — the row's entire story, §B.16), status, block_time |
| Stored, not returned | btc_amount raw |
| Derivable | resolve order_match_id → pair/price of the settled trade; USD via `prices` |
| **Verdict** | **Link `order_match_id`** — already returned; a btcpay without its match is a context-free BTC transfer. |

### bets
| | |
|---|---|
| Displayed | block_index, source, feed_address, wager_quantity (raw sats — known bug), status, tx_hash |
| Returned, hidden | **`bet_type`** (Bullish/Bearish CFD, Equal/NotEqual), **`counterwager_quantity`** (the odds), `deadline`, `target_value`, `leverage`, block_time |
| Stored, not returned | `wager_remaining`/`counterwager_remaining` (fill), `expiration`/`expire_index`, `fee_fraction_int` |
| Derivable | odds = wager/counterwager; feed reputation via broadcasts history |
| **Verdict** | **`bet_type` + `counterwager_quantity`** — both returned; type and odds are what a bet *is* (§B.12), and they cost only cells. |

### issuances
| | |
|---|---|
| Displayed | block_index, asset(+longname), quantity_normalized, issuer, status, tx_hash |
| Returned, hidden | block_time, source, `transfer`, `divisible`, `locked`, `description` |
| Stored, not returned | **`asset_events`** (Counterparty's own action string — `creation`, `reissuance`, `lock_quantity`, `transfer`, `reset`, `change_description` — the §B.3 Action column is stored verbatim, not derived), `fee_paid` (XCP — a mined column), `mime_type`, `reset`, `callable`/`call_date`/`call_price`, msg_index, tx_index |
| Derivable | Action badge falls out of `asset_events` directly; art thumbnail via mime_type/stamp tag |
| **Verdict** | **SELECT `asset_events` → Action badge** — the defining mined column that TABLES.md scored as "derive it" is actually raw captured data one column away. |

### fairminters
| | |
|---|---|
| Displayed | block_index, asset(+longname), price, hard_cap, status, source |
| Returned, hidden | **`earned_quantity`** (minted so far) + hard_cap → **progress %** for free, `soft_cap`, `paid_quantity`, `divisible`, block_time |
| Stored, not returned | `start_block`/`end_block` (mint window), `soft_cap_deadline_block`, `premint_quantity`/`pre_minted`, `max_mint_per_tx`/`max_mint_per_address`, `minted_asset_commission_int`, **`burn_payment`** (XCP burned vs paid to issuer — changes what "price" means), `lock_quantity`/`lock_description`, `description`, `mime_type`, `asset_parent`, `quantity_by_price` |
| Derivable | window state (upcoming/live/ended) from start/end_block vs tip; XCP price → USD via `prices` |
| **Verdict** | **Minted % (`earned_quantity`/`hard_cap`)** — §B.13 asked for "Minted %?"; both operands are already on the wire. |

### fairmints
| | |
|---|---|
| Displayed | block_index, asset, earn_quantity (raw — known bug), source, tx_hash |
| Returned, hidden | **`paid_quantity`** (what the minter paid — §B.14's "Paid (XCP)?"), `fairminter_tx_hash`, status, block_time |
| Stored, not returned | `commission` |
| Derivable | effective unit price = paid/earned; USD via `prices` |
| **Verdict** | **`paid_quantity` column** — already returned; mint-for-free vs paid-mint is the row's one interesting split. |

### dividends
| | |
|---|---|
| Displayed | block_index, asset, dividend_asset, quantity_per_unit_normalized, source, tx_hash |
| Returned, hidden | block_time, status |
| Stored, not returned | **`fee_paid`** — mined column, and it *encodes recipient count* (protocol charges 0.0002 XCP per holder paid, so fee_paid/20000 sat = recipients) |
| Derivable | recipients from fee_paid (above); total distributed ≈ per_unit × supply; USD when dividend_asset is XCP via `prices` |
| **Verdict** | **`fee_paid` → Recipients** — "how many holders got paid" is the dividend question, and the fee already counts them. |

### destructions
| | |
|---|---|
| Displayed | block_index, asset, quantity_normalized, tag, source, tx_hash |
| Returned, hidden | block_time, status |
| Stored, not returned | quantity raw |
| Derivable | % of supply destroyed (assets.supply); asset quality tier |
| **Verdict** | Time (T4) — column set is otherwise complete; the leanest table in the mirror. |

### burns
| | |
|---|---|
| Displayed | block_index, source, burned_normalized, earned_normalized, tx_hash |
| Returned, hidden | block_time, status |
| Stored, not returned | burned/earned raw |
| Derivable | **USD-at-burn via `prices`** (BTC day price × burned); implied XCP cost basis (burned×BTC-USD/earned) |
| **Verdict** | USD value of the burn — turns a 2014 curiosity into "this address paid $X for its XCP". |

### broadcasts
| | |
|---|---|
| Displayed | block_index, source, value, text, tx_hash |
| Returned, hidden | block_time, `timestamp` (the feed's own clock), **`locked`** (feed permanently closed), `mime_type`, status |
| Stored, not returned | `fee_fraction_int` (the cut the feed operator takes from bets — mined `Fee` column) |
| Derivable | oracle attribution: is this source a dispenser oracle (`dispensers.oracle_address`) or bet feed (`bets.feed_address`)? |
| **Verdict** | **`locked` badge + oracle attribution** — separates dead feeds and price oracles from one-off graffiti. |

### trades (unified sales tape)
| | |
|---|---|
| Displayed | block_time, venue, asset, quantity, total(+currency), usd_value, buyer, block_index, tx_hash |
| Returned, hidden | **`price`** (unit price — the generated column exists precisely for the tape and isn't a column), **`seller`** (mined tapes always show both parties) |
| Stored, not returned | — (COLS selects every column) |
| Derivable | **self-trade flag** (`buyer = seller` per row) and asset `low_quality`/`self_trade_pct` dimming via asset_signals; buyer/seller curated labels; asset quality tier |
| **Verdict** | **Price + Seller + a wash-trade dim** — a sales tape that hides unit price and one side of every trade, over a ledger that already knows which assets self-trade. |

### blocks
| | |
|---|---|
| Displayed | block_index, block_time, transaction_count, block_hash |
| Returned, hidden | — (BLOCK_COLS is fully rendered) |
| Stored, not returned | `ledger_hash`, `txlist_hash`, `messages_hash`, `previous_block_hash`, `difficulty` (detail-only today) |
| Derivable | block interval (Δblock_time between consecutive rows — client-side); "notable" flag (Counterparty tx types in block — needs a query) |
| **Verdict** | Closest to done; hash columns belong on detail. Only interval is worth a look. |

### holders (asset balances tab)
| | |
|---|---|
| Displayed | holder (+burn/exchange badges), quantity_normalized |
| Returned, hidden | holder_type (drives cell logic only), quantity raw |
| Stored, not returned | `balances.updated_block_index` ("last moved" — diamond hands vs fresh bag), `balances.utxo_address` (controlling address of a utxo-attached row — today utxo rows are dead mono strings) |
| Derivable | **% of supply** (supply_normalized already on the same page) + rank #; holder reputation tier (holderTiers machinery in queries/assets.ts); curated `exchange_name` label ("Poloniex", not just "exchange"); graph trust tier |
| **Verdict** | **% of supply per row** — the concentration question every cap-table reader is asking; the denominator is already on the page. |

### Top 10 unsurfaced additions, ranked

1. **dispenses: `btc_amount` → Price (BTC) / Total / USD** — stored since 0002, already
   USD-priced in the `trades` ledger; converts the weakest table (a sale rendered as a gift)
   with data we've had all along.
2. **order_matches: normalized Price / Quantity / Total trade view** — quantities are returned
   (raw); the divisibility join is a copy of ORDER_SELECT. Fixes gap-list #1.
3. **orders: `give_remaining`/`get_remaining` → Filled % + `expire_index` → Expires** — the two
   live questions about an open order; both stored, neither SELECTed.
4. **dispensers: `status` badge + `operator_trust`** — status is on the wire globally,
   operator_trust is on the wire for asset tabs and rendered nowhere; together they answer
   "is this machine on, and do I trust it?". (`escrow_quantity` completes the mined
   remaining/escrow cell.)
5. **issuances: `asset_events` → Action badge** — the mined table's defining column turns out to
   be *stored verbatim*, not derivation work.
6. **transactions: message-type chip decoded from `data`** — the generic tx list currently
   answers no question at all; the payload is in the mirror.
7. **holders: % of supply (+ `updated_block_index` "last moved")** — concentration is the
   cap-table question; denominator already on the page, recency already in `balances`.
8. **trades: unit `price` + `seller` + self-trade dim** — the tape hides the generated price
   column and one party, while `asset_signals.self_trade_pct`/`low_quality` sit unused for
   wash-trade honesty.
9. **fairminters: Minted % (`earned_quantity`/`hard_cap`)** — both operands already returned;
   one cell turns a config dump into a progress table. (Pairs with fairmints' returned-but-hidden
   `paid_quantity`.)
10. **sends: `send_type` chip** — returned today; attach/detach/MPMA/move are different actions
    the table flattens into "send". (Cheapest item on this list.)

Cross-cutting: the `prices` calendar (BTC/ETH/XCP daily USD) is used only by the trades ledger —
burns, dispenser prices, order totals and fairmint payments could all carry a USD `title`/column
via the same day-lookup. Curated `exchange_name` labels and `address_signals` badges render only
on the holders tab; every addrCell could carry them.

## Input 3 — research survey provenance (2026-07, adversarially verified)

Method: 6 search angles → 25 sources fetched → 123 claims extracted → top 25 verified by 3
independent verifiers each → 20 confirmed / 5 refuted → 11 synthesized findings. Findings are
folded into "The rules (final)" above with citations; this stanza records what survived and what
died.

Survived (finding → rule): zebra striping weak/no-harm, Enders/A List Apart, high → R11;
importance-ordered columns, NN/g, high → R1; human-readable first column, NN/g, medium → R2;
hover/border/striping as place-keepers, NN/g, medium → R11; F-pattern is a conditional fallback,
NN/g + Djamasbi, high → R13; lawn-mower is comparison-only, NN/g, high → R13 caution; bypassing
pattern, NN/g, high → R4; headers ≈ half of fixations, UNC thesis, medium → R6; green/red must
not be hue-only, Bloomberg CVD, high → R8; no default cell flashing, AG Grid, high → R12; full
addresses vs address-poisoning, USENIX Sec 2025 + arXiv 2508.12107, high → R5.

Refuted (0-3 / 1-2, all variants of one idea): "the leftmost column gets the most fixations,
therefore payload-left" — the eye-tracking studies behind it cover text pages and comparison
tables, not record tables. Payload-first survives on importance-ordering + bypassing instead.
Also killed: two over-strong readings of the zebra-striping data (both directions).

No surviving claims (stay practitioner convention): numeric formatting/precision/compaction and
the Tufte/Few/Butterick canon; WCAG dense-table floors, link-row screen-reader semantics, touch
targets; empty states and skeleton rows.

Open questions worth revisiting: safe truncation length for base58/bech32 (poisoning corpus is
40-char hex; 4+4 fails, full display is the only proven floor); whether record-log users actually
scan column-wise (no eye-tracking study of transaction tables exists); numeric-formatting error
rates (no controlled evidence found).

---

## The framework floor (2026-07-07)

Mined from the primary docs/source of seven mature table systems: GOV.UK Design System
(govuk-frontend `_mixin.scss`), USWDS `usa-table`, IBM Carbon data table (style.mdx), Material
Design data tables (M1 + M2 specs), Ant Design Table (v5 tokens), AG Grid + TanStack Table
(behavioral conventions), Bootstrap 5 + the Tailwind idiom (baseline CSS). Where they agree,
that's the floor — a system below it needs a reason, not a preference.

### (a) Consensus values across systems

| Property | GOV.UK | USWDS | Carbon | Material | Ant | AG Grid | Bootstrap | Tailwind idiom | **Floor (agreement)** |
|---|---|---|---|---|---|---|---|---|---|
| Row height, default | ~45px (10px pad-y + 19px type) | — (padding-based; `--compact` variant) | **48px (lg, default)**; xs 24 / sm 32 / md 40 / xl 64 | **52dp** (M2; M1 was 48dp) | ~54px (16px pad-y) | **42px** (Quartz theme) | ~41px (.5rem pad-y) | py-4 ≈ 52px | **Comfortable 42–52px; compact 32–40; dense floor 24 (Carbon xs)** |
| Row height, compact | small-text-until-tablet modifier | `usa-table--compact` | md 40 / sm 32 | — | middle ~46 / small ~38 | `spacing` param scales all padding | `.table-sm` ~33px | py-2 | **32–40px** |
| Cell padding y | 10px | padding-based | derived from row height | derived (52dp row) | **16 / 12 / 8** (lg/md/sm) | multiple of `spacing` | 8px (.5rem); sm 4px | py-3/py-4 (12/16) | **8–16px by density** |
| Cell padding x | 20px right, **0 left** (flush idiom) | — | **16px** (`$spacing-05`) | **16dp** edge; 32dp+ (M2) / 56dp (M1) between columns | **16** lg / **8** sm | multiple of `spacing` | 8px | px-3/px-6 (12/24) | **8–16px; 16 is the mode** |
| Header typography | **bold**, sentence case, body size | bold, sentence case | **14px SemiBold 600** (`$heading-compact-01`), sentence case | **12sp Medium**, 54% black (lighter + smaller) | 600 (fontWeightStrong), body size | theme font, one weight up | th bold (weight var = null) | `text-sm font-semibold` | **One weight step heavier (500–700), sentence case. NO system uppercases headers.** |
| Numeric alignment | `--numeric` classes: header AND cell `text-align:right` | `font-mono-sm text-tabular text-right` | right for numbers | "Right-aligned numeric columns; left-aligned text" | per-column `align` | per-column | utilities | `text-right tabular-nums` | **Unanimous: numbers right + tabular; the numeric HEADER right-aligns too; text left; never center** |
| Borders | `border-bottom: 1px solid` (functional border grey) only | bordered default; borderless variant | `border-bottom: $border-subtle` only | 1px row dividers | horizontal split lines | horizontal row borders | border-bottom via `$table-border-*`; vertical only with `.table-bordered` | `divide-y divide-gray-200` | **Unanimous: 1px horizontal dividers only; vertical rules are opt-in everywhere** |
| Zebra / hover | neither — plainest system | `--striped` opt-in | zebra opt-in (`$layer-accent`); hover `$layer-hover` | hover Grey 200; selected Grey 100 | hover built-in | hover built-in | `.table-striped` / `.table-hover` opt-in (5% / 7.5% emphasis) | opt-in | **Zebra: always opt-in, never default. Hover: low-alpha (3–8% emphasis)** |
| Sticky header | not shipped | `usa-table--sticky-header` | `stickyHeader` (React) | in implementations | `sticky` prop (4.6+) | **inherent — virtualized body scrolls under pinned header** | not shipped | `sticky top-0` | **Ship it: `position:sticky; top:0` + opaque bg + z-index on header cells** |
| Responsive strategy | small-text modifier; scroll implied | **two named modes: `--stacked` (data-label blocks) vs scrollable container (`tabindex="0"`) — "scrollable is ideal for dense data"** | scroll | horizontal scroll in container | per-column `responsive` breakpoint arrays (hide columns) | horizontal scroll + column virtualization | `.table-responsive{-sm..xxl}` overflow wrapper | overflow-x wrapper | **Two schools: scroll/stack (gov systems — never hide data) vs column-hiding (Ant, trading UIs). Pick one deliberately; if hiding, scrolling should remain the fallback** |
| Sort behavior | not shipped | `aria-sort` none/ascending/descending on `th`; **`aria-live="polite"` announcement region**; `data-sortable` | icon in header, 8px pad | icon 16dp, 38% black on hover → 87% active; M1 toggles asc/desc | **tri-state ascend → descend → null**; custom `sortIcon` | **tri-state asc → desc → none; shift = multi-sort** | not shipped | not shipped | **Tri-state cycle, whole header is the button, icon right of label, dormant icon appears on hover, `aria-sort` + polite announcement (USWDS is the a11y reference)** |
| Truncation | wrap (prose tables) | wrap | ellipsis | **"truncated with an ellipsis… on hover a tooltip shows the full name"** | `ellipsis` prop (forces `table-layout:fixed`), `showTitle` default | ellipsis default | wrap | `whitespace-nowrap truncate` | **Data grids: single-line + ellipsis + full value on hover/title. Ellipsis implies fixed/explicit column widths** |
| Column widths | width override classes | — | — | — | per-column `width`; fixed layout with ellipsis | default col width, flex sizing | — | `table-fixed` | **Explicit widths for data grids; TanStack defaults: size 150 / minSize 20 / maxSize ∞ — every column has a min floor** |

Also unanimous where present: units/context live in the header not the cell; `<caption>` (or an
accessible name) + `scope`/columnheader semantics are required (GOV.UK, USWDS); header row same
height as body rows or slightly taller (Material +4dp), never shorter than a body row's touch
target.

### (b) Behaviors we don't have — with the reference implementation

1. **Sticky header** — reference: USWDS `usa-table--sticky-header` / AG Grid (pinned by
   architecture). R6 already mandates it; `.xt-head` has the opaque `--panel2` background ready,
   it just isn't `position:sticky`.
2. **Sortable headers** — reference: **USWDS sortable spec** (the only one with the full a11y
   recipe: `th[data-sortable]` + `aria-sort` + button-in-header + `usa-table__announcement-region`
   with `aria-live="polite"`); behavior reference: AG Grid tri-state asc→desc→none, shift for
   multi-sort. Ours are server-ordered with zero user control.
3. **Empty state** — reference: Ant Design (built-in `Empty` render when `dataSource` is empty).
   `RecordTable` given `rows=[]` renders a header row floating over nothing.
4. **Loading skeleton** — reference: Carbon `DataTableSkeleton` (skeleton rows matching the real
   column template, no layout shift). Low urgency under RSC/SSR, but the pattern matters the day
   any table fetches client-side.
5. **Column min-width floor + scroll fallback** — reference: TanStack (`minSize: 20` exists on
   every column by default) + USWDS scrollable container. Our text tracks are `minmax(0,1fr)` —
   legal to crush to 0; and when priority-dropping isn't enough there is no `overflow-x` fallback,
   the gov-system answer to "never silently lose data".
6. **Accessible name** — reference: GOV.UK/USWDS `<caption>`. Our `role="table"` div has no
   `aria-label`; screen-reader users get an anonymous grid.

### (c) The floor as a checklist

1. Row height 42–52px comfortable, 32–40px compact; never below 24px.
2. Cell padding-x 8–16px, identical in header and body; padding-y 8–16px by density.
3. Numbers right-aligned tabular/mono — and the numeric column's HEADER right-aligns with them.
4. Text left-aligned; nothing is center-aligned in a data table.
5. Header is one signal heavier than body: one weight step (500–700) OR uppercase+tracking — the
   big systems all chose weight + sentence case; if you keep the terminal uppercase idiom, don't
   also stack a big weight delta on top.
6. Dividers: 1px horizontal only; vertical rules opt-in; no double borders (last row loses its
   border inside a framed container).
7. Zebra opt-in only; hover + focus-within highlight at low alpha (3–8% emphasis) as the
   place-keeper.
8. Header sticks (`position:sticky; top:0`, opaque background, z-index) on any table taller than
   the viewport.
9. Sortable header = the whole header is the button; tri-state asc→desc→none; icon right of the
   label, dormant until hover on unsorted columns; `aria-sort` + polite live-region announcement.
10. Cells never wrap; ellipsis + the full value in `title` (or tooltip).
11. Every column has a minimum width; when columns can't fit: drop by declared priority or scroll
    horizontally — never crush below legibility, never lose data without a fallback.
12. Units and currency live in headers, never repeated per cell.
13. Empty result renders an explicit "No {things} found" row spanning the template — a header over
    nothing is a bug.
14. Client-side loading renders skeleton rows on the real column template (no layout shift).
15. The table has an accessible name (caption or `aria-label`) and real header semantics
    (`scope` or `role="columnheader"`); ~hundreds of rows → paginate; thousands in one scrollport
    → virtualize (AG Grid/TanStack).

### (d) Diff: `.xtable` + `RecordTable` vs the floor

**Passes** — row height ≈38–40px (9px pad-y + 13px/20px type: consensus compact band); padding-x
14px + 12px column gap (in band, 16-adjacent); numeric right + `tabular-nums` mono with `.r`
right-aligned headers (#3); text left, nothing centered (#4); 1px horizontal dividers only,
last-row border removed inside the framed container (#6); no zebra, hover + `:focus-within`
highlight at `rgba(255,255,255,.03)` (#7); single-line ellipsis cells with full values in `title`
(#10, the `min-width:0; white-space:nowrap; text-overflow:ellipsis` rule); units-in-headers is R6
policy (#12, partially rolled out); priority-based column dropping at 1000/760/560px is the
Ant/trading-UI school of #11, declared per column — legitimate; div-grid carries
`role="table"/"row"/"columnheader"/"cell"` (#15 semantics half).

**Below the floor** — no sticky header (#8 — one CSS rule away, R6 already requires it); no sort
affordance at all (#9); no empty-state row in `RecordTable` (#13); text tracks are `minmax(0,1fr)`
with no min floor and no horizontal-scroll fallback when dropping isn't enough (#11 second half);
no accessible name on the grid (#15); no skeleton pattern (#14, deferred while tables are
server-rendered).

**Deliberate deviation, keep but know it** — `.xt-head` stacks THREE header signals (10px mono +
uppercase + .08em tracking + weight 500 + muted color) where every surveyed system uses exactly
one (a weight step, sentence case). The uppercase micro-header is the financial-terminal idiom,
not the design-system floor (#5) — consistent with the product's genre; the weight-500 bump on top
is the part that's redundant.
