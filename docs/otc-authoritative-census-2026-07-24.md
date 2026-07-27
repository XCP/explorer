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

## Addendum 2026-07-26: production state after the final-window rebuild

Measured directly against production `xcpio-core` after the Bitcoin scan reached its final
watermark (959,434) and the final-window census scripts ran:

- **5,555** OTC trades with venue `otc`, **$5,669,791.96** known execution-day USD;
- exactly 5,555 evidence rows and 5,555 payment legs — no orphans in either direction.

Production is now ahead of this document's 2026-07-24 ledger (5,444 admitted) because the
final-window rebuild (`build-local-otc-final.mjs`, `analyze-local-otc-final-gaps.mjs`) extended
coverage beyond the 855,207 fresh-scan boundary. The dated SQLite ledger remains the audit
input; production totals are the deployed result of the same single methodology.
