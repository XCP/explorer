# Legacy app.xcp.io import — export instructions (group B)

The old Laravel app (`XCP/app.xcp.io`, MySQL) holds two things our pipeline lacks:
1. **CEX/CMC USD price calendar** (`price_histories`) — real Zaif + CoinMarketCap prints, graded by
   `usd_fidelity_level`, covering pre-2015-07 (which our Coinbase-only feed can't reach).
2. **Sales from venues we don't index** (`trade_histories`) — most importantly **Scarce.city**
   (a Bitcoin-native marketplace, invisible to our Ethereum/Alchemy Emblem crawl), plus Zaif CEX.

The read API is behind a Cloudflare managed challenge, so we import from a DB export instead.

## Getting a fresh dump (the marketplace/CEX data is only in the LIVE DB)

The infra-audit backups are from 2024-08-05 — BEFORE the Reservoir/OpenSea/Zaif/Scarce.city
indexers ran (proof: those jobs use a `tx_hash` column the backup's `trade_histories` lacks). The
data lives in the live DigitalOcean DB `api_xcp_io` on
`content-nebula-do-user-14227420-0.b.db.ondigitalocean.com:25060` (creds in
`infra-audit/findings/do_do2_db_contentnebula.json`). Run this from a machine with the password:

```bash
# from the infra-audit dir (has the connection json); pull the password into an env var first
PW=$(node -e 'console.log(require("./findings/do_do2_db_contentnebula.json").database.connection.password)')
mysqldump --host=content-nebula-do-user-14227420-0.b.db.ondigitalocean.com --port=25060 \
  --user=doadmin --password="$PW" --ssl-mode=REQUIRED --no-tablespaces --single-transaction \
  --skip-lock-tables api_xcp_io \
  trade_histories trading_pairs price_histories ohlc_data \
  | gzip > ~/Documents/GitHub/xcp-explorer/apps/api/ops/legacy/api_xcp_io_fresh.sql.gz
```
(If `price_histories` or `ohlc_data` don't exist on live, drop them from the table list — the two
that matter are `trade_histories` + `trading_pairs`.) Then tell me; I parse the gz directly.

## What to export — two CSVs

Run these against the app's MySQL and save the CSVs into `apps/api/ops/legacy/` (gitignored).

**1. `prices.csv`** — the USD price calendar:
```sql
SELECT asset,
       DATE(confirmed_at)         AS day,
       price_usd,
       volume,
       usd_fidelity_level
FROM price_histories
ORDER BY asset, day;
```

**2. `sales.csv`** — sales from venues we're missing (skip `dex`, which we already mirror on-chain;
keep everything else — scarce.city, zaif, opensea/reservoir Emblem if the DB has more than our 34k):
```sql
SELECT th.type                    AS source,   -- 'scarce.city' | 'zaif' | 'opensea' | ...
       th.direction,
       th.price,                              -- in the pair's quote unit (scarce.city = BTC)
       th.price_usd,
       th.volume,
       th.volume_usd,
       th.confirmed_at,
       th.address,
       th.link,                               -- unique per sale (our idempotency key)
       tp.name                    AS pair      -- e.g. "RAREPEPE/XCP"
FROM trade_histories th
LEFT JOIN trading_pairs tp ON tp.id = th.trading_pair_id
WHERE th.type <> 'dex'
ORDER BY th.confirmed_at;
```

## Export format
- CSV with a header row, UTF-8, comma-delimited, standard quoting. (mysqldump SQL also fine — I can
  parse INSERTs — but CSV is cleaner.) From the MySQL CLI:
  `mysql -e "SELECT ..." --batch --raw db > prices.csv` (tab-delimited is fine too; tell me which).
- Rough sizes: `price_histories` is per-asset-per-day (tens of thousands of rows); `trade_histories`
  minus dex is likely low-hundreds-of-thousands at most. Both fit a plain file.

## Then
Drop the two files in `apps/api/ops/legacy/` and tell me. I build the ingest against the real rows:
- `prices.csv` → merges into the `prices` calendar with a `source` + `fidelity` column (CMC/CEX
  prints WIN over our forward-filled DEX-derived days).
- `sales.csv` → resolves `pair` → base/quote, prices via the calendar, and lands in the unified
  `trades` ledger as the `scarce.city` / `zaif` venues (idempotent on `link`).
