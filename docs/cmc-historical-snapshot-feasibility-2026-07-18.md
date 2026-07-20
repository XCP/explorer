# CoinMarketCap historical-snapshot feasibility

Date: 2026-07-18

The supplied historical snapshot pages return server-rendered HTML containing a structured `__NEXT_DATA__` payload.
The payload exposes CoinMarketCap identity, rank, USD and BTC price, 24-hour aggregate volume, reported market cap,
circulating supply, and timestamps. A diagnostic check of 2016-12-27 found 200 ranked rows and BitCrystals UCID 1063
at $0.11019594 with $18,039.01 reported 24-hour USD volume.

## Identity-reviewed targets

| Counterparty asset | Historical CMC name | Symbol | UCID | Historical slug |
| --- | --- | --- | ---: | --- |
| BITCRYSTALS | BitCrystals | BCY | 1063 | bitcrystals |
| SCOTCOIN | Scotcoin | SCOT | 346 | scotcoin |
| LTBCOIN | LTBcoin | LTBC | 550 | ltbcoin |
| GEMZ | GetGems | GEMZ | 779 | gems |
| SWARM | Swarm | SWARM | 607 | swarm-old |
| TILECOINX | TileCoin | XTC | 694 | tilecoin |
| FLDC | FoldingCoin | FLDC | 606 | foldingcoin |
| SJCX | Storjcoin X | SJCX | 549 | storjcoin-x |
| PEPECASH | Pepe Cash | PEPECASH | 1405 | pepe-cash |
| DATABITS | Databits | DTB | 1603 | databits |
| TRIGGERS | Triggers | TRIG | 1423 | triggers |
| ZAIF | ZAIF | ZAIF | 1219 | zaif |

These mappings come from CoinMarketCap's official ID map and the canonical production asset dictionary. `TILECOINX`
is the historically relevant Counterparty asset; the earlier provisional `TILECOIN` mapping was corrected. Symbols alone
are unsafe: current CMC contains unrelated later `GEMZ` and `SWARM` identities. Current metadata can also be retrofitted
onto historical rows; for example, the 2016 BitCrystals snapshot presently carries an Ethereum platform contract.
Platform metadata must therefore not be interpreted as historical chain identity.

CMC UCID 788 spans the old Counterparty Circuits of Value asset and the migrated Ethereum token. It is therefore
allowlisted only for the bounded Counterparty window from the canonical first issuance on 2016-08-07 through
2019-05-30, the day before Bittrex's Counterparty-token delisting. CICC has no matching CMC identity in the official
map.

## Access decision

Although `robots.txt` permits `/historical/`, CoinMarketCap's current Terms of Use expressly prohibit automated data
mining, crawling, scraping, and storing website content without authorization. The public-page structure is technically
crawlable, but a slow crawler would still violate that stated condition. No long crawl was started and no snapshot
page data was imported.

The authorized route is CoinMarketCap's historical quotes API. The repository now has
`ops/import-cmc-counterparty-history.mjs`, which requires `CMC_API_KEY`, an allowlisted `CMC_ASSET`, and explicit start
and end dates. It validates UCID, name, symbol, and slug; stores the series as aggregate observations rather than venue
executions; retains reported USD volume and market cap; hashes the raw response; and records an import manifest.

The initial historical-page payload exposes the first 200 ranked rows and ignores ordinary `page` and `start` query
parameters. The rendered page has a Load More control that obtains additional rows client-side, so 200 is an initial
payload limit rather than proof that lower-ranked rows are unavailable. That request mechanism was not automated
because current CMC terms prohibit scraping without authorization. With permission, a page collector would still need
to exhaust Load More, verify terminal row counts, and distinguish a missing asset from an incomplete page. The official
per-asset API avoids that rank-dependent collection problem and is methodologically better.

## Interpretation

CMC aggregate price and volume can corroborate or fill an aggregate USD calendar. They cannot reconstruct Poloniex,
Bittrex, or another venue, and their aggregate volume cannot be decomposed into constituent exchanges. Every imported
row must retain `source=coinmarketcap`, `venue=aggregate`, the UCID-bound identity, and the original response checksum.
