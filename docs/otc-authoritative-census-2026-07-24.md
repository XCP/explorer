# Authoritative OTC census (2026-07-24)

The authoritative local OTC result is the dated SQLite ledger:

`C:\BitcoinIndex\otc-complete-authoritative-20260724.sqlite`

It is one deduplicated result, not a choice between scan tiers. The fresh ledger census was scanned through Bitcoin block **855,207** and then merged with previously admitted, audited matches so a rerun cannot regress coverage merely because a promotion lane is no longer reproducible from a narrower fresh window. The older databases are inputs/audit history only; they are not public counts.

Current result:

- **5,444** admitted OTC matches
- **5,416** clean matches after the low-quality-asset exclusion
- **28** low-quality-asset matches retained for audit but excluded from clean presentation
- **$5,611,817.21** total BTC-denominated value using the ledger's daily BTC/USD prices

The fresh strict pass itself contributed 4,444 rows; the union adds 25 genuinely new rows to the prior admitted set and deduplicates the overlap. This is why the authoritative number is larger than the fresh strict lane alone.

The production trades page may differ by a small amount until this dated ledger is imported; that is a deployment difference, not a second methodology.
