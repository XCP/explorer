# Counterparty economic archaeology

Date: 2026-07-24

Status: exploratory case reconstruction. Address families are evidence-backed wallet-operation candidates,
not personal identities. USD totals inherit the production trade ledger's price coverage and quality rules.

## Why this pass exists

Network totals obscure the Bitcoin index's most valuable contribution: connecting address-level events into
longitudinal economic operations. This pass ranks cases using repeated clean common-input evidence, then
joins those candidates to canonical DEX, dispenser, reconstructed OTC, and issuance records. A later
co-spend must not be projected backward as proof of common control at an earlier trade.

## Case 1: cross-venue currency dealer

The three-address family centered on `1JsPoV5USoFM7441KtGXtvMH5ezNwq9Uak` has ten clean repeated
common-input events. Its members collectively record 289 DEX trades and 1,358 dispenses in the local signal
snapshot.

The canonical trade ledger links the reviewed members to approximately $731,168 of priced activity:

- 1,407 dispenser trades totaling $638,669.25;
- 166 DEX trades totaling $92,469.04; and
- one reconstructed OTC trade totaling $29.54.

Only seven dispenser trades ($323.97) and one OTC trade ($29.54) are internal to the reviewed family; no
internal DEX trade appears. The operation predominantly sold XCP ($589,894.88 across 1,111 trades) and
PEPECASH ($71,015.67 across 284 trades), while its largest acquisitions were XCP ($27,832.35) and PEPECASH
($8,017.42). This is consistent with a real cross-venue currency dealer or liquidity operation using
multiple wallets, not an operation dominated by manufactured internal volume.

## Case 2: creator-market studio

An eleven-address family centered on `1NVVLyy745iW4gYXHTSg9uHfTjScE82VT` has 51 repeated common-input
events. The signal snapshot records 169 DEX trades, 246 dispenses, and 80 issuance events across the family;
the canonical issuance ledger attributes 33 distinct issued assets to the center, including CREMAPEPE,
MAKEARTPEPE, PONZIBEAR, and MOBYDICK.

The reviewed members touch approximately $317,971 of priced trades:

- 532 dispenser trades totaling $229,982.41;
- 153 DEX trades totaling $87,146.26; and
- six reconstructed OTC trades totaling $842.28.

Only two dispenser trades ($1,477.87) are internal. Important sold assets include CREMAPEPE ($38,980.72),
FAKEASF ($24,824.79), MAKEARTPEPE ($16,612.04), and PONZIBEAR ($14,205.81). The family also acquired
FAKEASF, BLOOMER, HAIRPEPE, CREMAPEPE, and other third-party assets. This resembles a combined creator,
collector, and dealer operation rather than a pure issuer wallet.

The family evidence was first observed after some early trades. It supports a later wallet-operation
relationship, not automatic retroactive ownership of every historical action.

## Case 3: FakeRare creator and market operation

The 22-address family centered on `1FakeRareTDi3PkHiehotQ2QAfUdw7Kzyc` has 64 clean common-input events.
The center issued 68 distinct assets in the canonical ledger, including FAKISTAN, MAKEART, ROTHKOMOTO,
FAKECEZANNE, and COUNTERFAKER. Separate family wallets supply most observed DEX and dispenser activity.

Four reviewed active members touch approximately $50,921 of priced activity:

- 178 dispenser trades totaling $48,770.80;
- 38 DEX trades totaling $789.76; and
- ten reconstructed OTC trades totaling $1,360.10.

Internal reviewed-family activity is small: two dispenser trades totaling $284.48 and one OTC trade totaling
$285.79. The family both acquired and sold FAKEASF, acquired PEPIO and several FakeRare-related assets, and
sold issued or ecosystem-related assets such as FAKECEZANNE. It is best described as a creator-market
operation with collection and resale behavior, subject to fuller member coverage.

## Infrastructure-label discovery

Strict pre-activity funding provenance exposed `1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s` as the unique funder of
116 later market addresses, totaling 13.986226 BTC. Multiple independent public sources label it as a
deprecated Binance hot wallet. The local Counterparty signal snapshot instead treated it as an ordinary
issuer-like address because unsolicited token activity contaminated its persona.

Infrastructure classifications must therefore override token-derived roles. This case also demonstrates a
valuable use of the Bitcoin graph: discovering exchange-funded adoption and repairing labels that materially
affect reputation, holder, graph, and provenance analysis.

## Next case-reconstruction work

1. Match canonical sale transaction hashes to clean Bitcoin outputs and classify proceeds retained,
   consolidated, reused, or sent toward known infrastructure.
2. Rank creator families by external-buyer reach and by the fraction of volume occurring after the control
   relationship was first established.
3. Identify repeat independent buyers shared across creator families to surface collectors, patrons, and
   cultural bridges.
4. Construct block-relative participant journeys across OTC, DEX, dispensers, Telegram, and Emblem.
5. Publish family evidence as inspectable edges and confidence levels; never silently merge addresses or
   rewrite reputation, holder counts, or volume.

## Proceeds-tracing checkpoint

The first set-based join matched 1,471 dealer-family sale records to the compact Bitcoin transaction index.
Only nine had a clean, uniquely attributable Bitcoin payment to the seller address: 0.04472640 BTC to the
primary dealer wallet and 0.00487555 BTC to its companion wallet. This is not evidence that the remaining
sales had no payment. Most sale records post-date the current Bitcoin scanner watermark, and many dispenser
payments use multi-input or multi-output transaction structures that the conservative direct-flow classifier
correctly refuses to attribute to one payer and payee.

The production interpretation is therefore three-valued: exact proceeds observed, payment unresolved, and
not applicable. “No clean match” must never be rendered as zero proceeds. The next scanner-complete pass
should materialize sale-hash joins and classify payment ambiguity separately from payment absence.
