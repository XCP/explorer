# Exact quantities and display preferences

Protocol quantities retain decimal strings through exact formatting. Converting a large normalized string to `Number` first can change its last integer or fractional digits. Raw-to-display conversion uses the asset's explicit divisibility: divisible assets use eight places, indivisible assets use whole units. XCP and BTC have eight places. Exact quantity rows reject unreadable values, unsupported precision, and already-unsafe numeric integers instead of displaying a different rounded amount. Wire values rounded before reaching the formatter cannot be recovered here.

`fromSatsExact` supplies canonical decimal text for transaction receipts and copyable amounts. `fromSats` remains an approximate arithmetic helper for charts, price ratios, and derived valuation; it must not feed copied transaction amounts or exact quantity rows. `commas` formats decimal strings without first converting them to floating point. Compact stats remain approximate presentation.

The current interface is English and uses an explicit `en-US` number format on server and client. Historical fiat values remain USD and the global price display names USD explicitly. No language catalog, currency conversion, or settings selector is added in this pass.

A future independent number preference must propagate through server-rendered pages and hydration. Historical multi-currency valuation also needs the correct dated FX rate, rather than relabeling old USD values or applying today's rate. Those are separate work from the exact quantity correction.

Playwright regressions cover quantities above the safe integer limit, the smallest divisible unit, indivisible whole units, excess precision, canonical copy text across display locales, and decimal-string formatting in Chromium. Production transaction-page fixtures exercise fairminter earned quantities and vend batches for both divisible and indivisible assets, with desktop/mobile rendering checks. Production build and the existing browser suite remain required checks.
