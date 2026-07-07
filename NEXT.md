# What's next — prioritized backlog (2026-07-07)

Pick from this; each item names its value, effort, and readiness. Grouped by track.
Source docs in parens.

## A. Finish the design pass (cheap, high polish, already in motion)

1. **Address page → v19 treatment** — the asset page got the full v19 overview (plate, fact card,
   makeup, tabs); the address page still has the older layout. Bring it to parity: identity band,
   reputation-first stats, Overview landing, feed tabs on the v20 grammar. *Value: consistency.
   Effort: medium. Ready now.*
2. **Home + remaining pages on v20/v19 grammar** — blocks, tx, tag, collections pages still mix old
   card styles. One sweep to the shared grammar. *Value: cohesion. Effort: medium. Ready.*
3. **Sortable table headers** — the one real table behavior we deferred (framework floor / TABLES.md);
   `aria-sort` + tri-state, USWDS recipe. *Value: real UX. Effort: small-medium. Ready.*

## B. Fix the USD numbers (the valuation you flagged as weak)

4. **CEX + CMC price-history ETL** (research-backlog §Data-acquisition-A) — one-time export of Zaif
   trades + CoinMarketCap historic dailies (XCP/PEPECASH/FLDC/BITCRYSTALS) from the old app.xcp.io
   MySQL into `prices`. Covers pre-2015 (currently unpriced) and prices PEPECASH-quoted trades we
   skip today. *Value: high — makes historic USD real. Effort: medium (ETL + one migration). Ready.*
5. **Price fidelity redesign** (research-backlog §C) — kill indefinite forward-fill (staleness
   cutoff → NULL), daily volume-weighted MEDIAN instead of VWAP (wash-resistant), derivation-depth
   admission as a gate not a grade. All verified against the thin-market literature. *Value: high —
   trustworthy prices + wash resistance. Effort: medium. Ready; pairs with #4.*

## C. Reputation & graph

6. **Final graph rebuild** — the one we prepped and never ran: broadened conduit exclusions,
   self-funding-send drop, FAKERARE-less grail seeds (9), 65 low-quality seeds. Cron is live now,
   so it needs the paused-single-driver protocol. *Value: medium — cleaner trust tiers. Effort:
   small (a throttled run). Ready.*
7. **Next scored feature** (research-backlog #1-2) — HODL-age / diamond-hands ratio and/or
   Gini/entropy holder concentration, through the signal-test harness + vaulted/grail gates.
   *Value: medium. Effort: medium each. Ready.*

## D. New capability — the wide Bitcoin picture (biggest new thing)

8. **Bitcoin follow-set indexer** (bitcoin-indexer.md) — the plan is complete and Sandshrew is
   verified. Phase 0 (create `xcpio-btc` DB + ingest endpoints) + summary backfill can start with
   zero new hardware (~90k addr/day on the free tier). Unlocks straw-buyer/wash-leg detection,
   clustering, and BTC context on address pages. *Value: high, distinctive. Effort: large, phased.
   Phase 0 ready; needs your go on the 4 decisions (all have recommendations).*

## E. Absorb the old systems (retire app.xcp.io)

9. **Consolidation service migration** (bitcoin-indexer.md §Related-systems) — move the bare-multisig
   UTXO index into `xcpio-btc` (index rows in D1, `prev_tx_hex` blobs in R2), port the two endpoints,
   repoint the extension. Best done *after* #8's follow-daemon exists (shares the per-block loop).
   *Value: medium (kills a running server). Effort: medium. Blocked on #8.*

## F. Product features

10. **"Holders also collect" relevance** (research-backlog §also-collect + design-lab v12) — the
    cheap version you chose: same-collection via existing tags + lift ranking, art-forward gallery
    card. *Value: medium — a smart section instead of a boring one. Effort: small-medium. Ready.*
11. **Table pass 3 — remaining unsurfaced fields** (TABLES.md audit) — most landed in the port;
    leftovers: order fill%/expires polish, dividends recipient-count, sweep flags. *Value: low-medium.
    Effort: small. Ready.*

## Owner-held (not mine to run)
- D1 read-replication dashboard toggle (beta; test DB `xcpio-reptest` already exists).
- The 4 Bitcoin-indexer decisions (all have recommendations in the doc).

---

### My recommended order if you want a suggestion
**#4+#5 together** (fix the USD numbers — highest value, self-contained, and everything downstream
trusts prices) → **#1** (address page parity — visible, cheap) → **#6** (graph rebuild — small) →
then decide **#8** (Bitcoin indexer) as the next big bet.
