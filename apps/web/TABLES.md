# TABLES.md — record-table design spec, mined from the owner's prior Counterparty UIs

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

## A. Touchstones — the cross-table invariants

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

## B. Per-record layouts (our 16 registry kinds)

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

## C. Cell recipes

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

## D. Gap list — ranked by distance from spec

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
