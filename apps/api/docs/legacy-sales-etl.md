# Legacy sales/price ETL — design (plan, not built)

*2026-07-07. Bringing the old app.xcp.io (`api_xcp_io` MySQL) sales + price data into our pipeline.
Principle: the old `trade_histories` flat shape does NOT dictate ours. We route each source to the
RIGHT home in our architecture — the polymorphic `trades` ledger fed by per-venue staging tables.*

## Our architecture (the target, already built)
- **`trades`** — the polymorphic sales ledger. PK `(venue, ref)`; columns venue · asset · block_time
  · quantity · currency · total · price(generated) · usd_value · buyer · seller · tx_hash. One query
  surface for every venue. Today: `dex` 112k · `dispense` 206k · `emblem` 30k.
- **Per-venue staging** — raw source tables that materialize INTO `trades` idempotently
  (INSERT OR IGNORE on the (venue,ref) key): on-chain venues from the Counterparty mirror by block
  cursor; `emblem_sales` (Alchemy ETH-marketplace) re-folded each pass.
- **`prices`** — the day×currency USD calendar (now with a `source` column); `applyTradeUsd` maps
  each trade's day+currency onto it.

## Routing the old `trade_histories.type` values (NOT a 1:1 copy)
| old `type` | what it is | our home | why |
|---|---|---|---|
| `order_match` | on-chain DEX | **SKIP** | we mirror this natively, more accurately (`dex`) |
| `dispense` | on-chain dispenser | **SKIP** | we mirror natively (`dispense`) |
| `btc_pay` / `burn` | on-chain | **SKIP** | native mirror |
| `scarce.city` | Bitcoin-native card marketplace, priced in BTC | **NEW** staging `scarce_city_sales` → `trades(venue='scarce.city', currency='BTC')` | a venue we're entirely blind to (not ETH, not on-chain) |
| `zaif` | CEX XCP↔JPY / XCP↔BTC | **`prices`** (real XCP price prints) + optional `trades(venue='cex')` | Zaif traded XCP itself — its value is PRICE, not card sales |
| `opensea` / `reservoir` | ETH-marketplace Emblem sales | **`emblem_sales`** (merge net-new only) | same venue as ours; we're already ahead (34k), so likely a no-op |

## New tables (numbered migrations)
- `scarce_city_sales(link PK, asset, price_btc, sold_at, buyer?, raw…)` — staging; `link` is the
  idempotency key (unique per sale in the source). Materialize → `trades(venue='scarce.city', ref=link)`.
- `cex_trades(source, pair, price, price_usd, volume, traded_at, …)` — ONLY if we want XCP exchange
  trades as rows; otherwise Zaif just feeds `prices`. Decide when we see the live row counts.

## USD attribution per new venue
- Scarce.city: BTC total → `prices` BTC/USD on the sale day (same path dispenses use). Clean.
- Zaif: the row's own `price_usd`/`volume_usd` are the CEX-graded USD — feed straight into `prices`
  for XCP (source='cex-zaif', winning over forward-filled DEX on covered days) per research-backlog §C.

## The pricing calendar, separately
Beyond sales, the old `price_histories` (if present on live) is the CoinMarketCap-era USD daily
series. Import into `prices` with `source='legacy-cmc'` (like the 2014 XCP gap-fill already done),
resolving by the source hierarchy: CMC/CEX prints > DEX-derived > forward-fill.

## Execution (once the dump lands in ops/legacy/)
1. `parse-dump-table.mjs <dump> trade_histories --jsonl` → filter to scarce.city / zaif / (net-new
   emblem); resolve `trading_pairs` name → asset via a second parse.
2. Push to a new admin ingest (`POST /admin/import-sales`) batching into the staging table(s).
3. Materialize into `trades`; run `applyTradeUsd`.
4. `price_histories` → merge into `prices` with source tags; re-price.
Numbers to confirm from the dump before building: live counts per `type` (how many scarce.city /
zaif rows actually exist), and whether `price_histories` exists on live.
