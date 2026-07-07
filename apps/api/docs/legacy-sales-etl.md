# Legacy sales/price — inventory + REBUILD plan (pivot 2026-07-07)

*The old app.xcp.io droplet that held the row-by-row marketplace `trade_histories` was DELETED
during the infra decommission (infra-audit XCP-API-PLAN.md: "DELETED DO droplet 396235341
xcp-laravel-app … 204"). We do NOT resurrect it. Where the source data still exists live, we
REBUILD from source into our own polymorphic `trades` ledger — cleaner and not tied to old shapes.*

## Machines still alive (infra-audit INVENTORY.md)
- **xcp-api** (Hetzner 91.99.189.190, Forge acct2) — api.xcp.io, slimmed to consolidation; DB `forge`
  has consolidation tables only, NO trade_histories.
- XC-Server (DO1 142.93.56.71) — xcpdex/digirare/bitcorns/xcpfox. DQ, BIT, IA servers (DO1).
- mission-control (DO2). app.xcp.io is now a Cloudflare Worker (R2 img + proxy), the droplet is gone.
- Ours: xcp-api.me-bbe.workers.dev + D1 `xcpio` (the new system — the target).

## Data we actually have (local backups + assets)
| file | contents | useful for |
|---|---|---|
| `api_xcp_io.sql.gz` (2024-08) | trade_histories = 182k **on-chain only** (order_match/dispense/btc_pay/burn) | nothing new — we mirror these natively |
| `app_xcp_curated.sql.gz` (34M) | curation: tags/attributes/consolidation + **assets table with market-data columns** carrying per-asset last/floor **scarce.city/zaif/opensea AGGREGATES** (131 assets) + 45 marketplace trading_pairs | seed/validation only (aggregates, not per-sale) |
| `digirare_db.sql.gz` (1.5G) | Digirare on-chain orders | already mirrored |
| `price_history_comparison.csv` | XCP/USD 2014-2024 | **DONE** — 2014-15 gap-fill applied |

**Bottom line: no preserved dump has the row-by-row Zaif/Scarce.city/OpenSea sales — that table
died with the droplet.** But most of it is rebuildable from live sources.

## Rebuild plan (source-code-driven, into our `trades` ledger)
| venue | status | rebuild source | target |
|---|---|---|---|
| **Scarce.city** | **rebuildable — API LIVE** ✅ (verified: `scarce.city/api/marketplace/digital/{asset}/sales` returns full history, BTC-priced) | port `ProcessScarceCityTradeHistoryJob`: iterate our assets, pull sales per asset | new staging `scarce_city_sales` → `trades(venue='scarce.city', currency='BTC')`, USD via prices calendar |
| **Emblem (OpenSea/Reservoir)** | **already ahead** | our own Alchemy `getNFTSales` crawl = 34k sales (more than the old app had) | already in `emblem_sales` → `trades(venue='emblem')` |
| **CMC historic prices** | partial | XCP done (CSV); other assets (PEPECASH/FLDC/BITCRYSTALS) re-fetchable from CoinMarketCap or the CSV | `prices` (source='legacy-cmc') |
| **Zaif CEX** | **likely lost** | Zaif is a DEFUNCT exchange; row-level sales only existed in the deleted droplet. Its VALUE was XCP price (covered by CSV/CMC). assets-table aggregates may hold a few last-trade values | accept loss; XCP price already covered |

## Execution (Scarce.city — the real win)
1. New indexer `apps/api/src/indexer/scarce-sales.ts` (fourth sidecar, like emblem-sales): per-block
   cron slice iterates the asset universe, `GET scarce.city/api/marketplace/digital/{asset}/sales`,
   upsert into `scarce_city_sales(asset, price_btc, sold_at, link PK)` — idempotent on the link/timestamp.
   Rate-limit politely; resumable asset cursor in indexer_state.
2. Materialize into `trades(venue='scarce.city', ref=link, currency='BTC', total=price_btc)` each pass.
3. `applyTradeUsd` prices them via the BTC/USD calendar. New venue appears in the unified stream.
Numbered migration for `scarce_city_sales`. Validate count/coverage against the app_xcp_curated
aggregates (131 assets had scarce.city market data) as a sanity check.
