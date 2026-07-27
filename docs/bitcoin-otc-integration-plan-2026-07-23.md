# Bitcoin-correlated OTC integration plan — 2026-07-23

## Product claim

The Bitcoin sidecar can identify a **likely direct on-chain OTC sale** when a recipient of a
Counterparty asset pays BTC to the asset sender in a bounded time window. This is stronger than
timing alone, but it is not proof that the parties are independent. At the owner's direction,
qualified rows enter canonical `trades` with venue `otc`; the evidence relation and methodology UI
must preserve that `likely` is an inference rather than documentary confirmation.

Public language:

- `likely on-chain OTC sale`: uniquely paired BTC payment and asset delivery passing the admission rules;
- `corroborated OTC sale`: the same legs are identified by contemporaneous marketplace, auction,
  signed quote, published transaction, or equivalent evidence;
- `rejected`: common-control, infrastructure, competing-payment, implausible-price, or other
  contradictory evidence.

## Evidence reproduced from the partial production index

The compact scanner had reached block 723,799 when these checks were run. It independently
reproduced three earlier provider-discovered candidates:

| Asset delivery | BTC transaction | Observed structure |
| --- | --- | --- |
| 1 XAJIBASILAAR, block 399,889 | `0184ee6bd7f4297d0b25fbc65595ecab225a547d8b82735d40f68fc5b8d8ac29`, 0.05 BTC | one buyer input; 0.05 BTC to seller; change to buyer; five blocks before delivery |
| 5.80359040 XCP, block 399,686 | `0af030262dbae99ea9d118c0ac60d225b1530981f8bb9360da59aabd49489406`, 0.00620790 BTC | one buyer input; payment to seller; change to buyer; 15 blocks before delivery |
| 100,000 PEPECASH, block 449,334 | `d5a3ac757fbf776decbb2adafa7a03ef2d6fe9f5a3ed2298af6ca224f23dab28`, 0.00100989 BTC | one buyer input; payment to seller; change to buyer; same block as delivery |

This demonstrates that `btc_tx`, `btc_address_io`, and `btc_direct_flow` contain the evidence needed
for deterministic candidate reconstruction. The flow rows carry ambiguity flags; a change output is
not itself a second payment.

## Materialization pipeline

1. Finish the compact scan, refresh its fixed target through the current Bitcoin tip, and pass the
   block/hash, fee, balance, and relational integrity gates.
2. Export eligible Counterparty sends from `xcpio-core` into a local staging table. Preserve event
   index, asset-delivery transaction hash, block/time, asset and quantity, sender, and recipient.
3. Attach the validated Bitcoin SQLite database and range-join each delivery to `btc_direct_flow`
   where payer is the asset recipient and payee is the asset sender.
4. Require a unique payment candidate inside each declared timing tier. Store every competing payment
   and delivery count so ambiguity is explicit rather than discarded.
5. Exclude known exchanges, burns, Emblem vaults, Swapbots, self-sends, and deliveries already
   represented by canonical trades. Apply low-quality status as a display/filter dimension, not as a
   substitute for transaction-level validation.
6. Calculate execution-time BTC/USD from the reviewed daily price series. Never infer consideration
   from the asset's later price.
7. Run same-owner and market-integrity tests: common inputs, buyer change, repeated reciprocal flow,
   shared funding, return cycles, implausible effective prices, duplicated BTC transactions, and
   mechanical vendor behavior.
8. Export reviewed, versioned evidence rows idempotently and project admitted `likely` and
   `corroborated` rows into canonical `trades` with venue `otc`.

## Proposed `xcpio-btc` candidate contract

One row represents a proposed pairing, not a trade assertion:

- stable candidate ID and method version;
- Counterparty event index and asset-delivery transaction hash;
- asset name, normalized quantity, buyer and seller addresses;
- delivery block/time;
- BTC payment transaction hash, output index, sats, block/time, and relative block distance;
- payer-input count, seller-output count, transaction structure flags, and change evidence;
- competing-payment and competing-delivery counts;
- infrastructure, common-control, repeated-flow, and price-plausibility flags;
- state: `candidate`, `reviewed_candidate`, `corroborated`, or `rejected`;
- reviewer note, evidence source/URL, timestamps, and coverage watermark.

Raw Bitcoin transaction facts remain in the normalized Bitcoin tables. The candidate table records
the reproducible join and review decision rather than duplicating all inputs and outputs.

## API and website integration

Initial public integration should expose both the trade and its inference status:

- asset page: an **On-chain OTC candidates** research panel with count, observed BTC consideration,
  timing tier, status, and a clear exclusion-from-volume notice;
- address page: **Bitcoin-correlated exchanges** showing whether the address delivered the asset or
  paid BTC, plus links to both transactions;
- transaction pages: reciprocal link between the asset delivery and proposed BTC payment;
- research/markets page: coverage watermark, reviewed/corroborated/rejected counts, timing
  distribution, and methodology;
- API: summary, asset/address candidate list, and candidate evidence-detail routes. Every response
  includes coverage height/hash, method version, state, and ambiguity flags.

OTC rows can appear in the ordinary trades UI and totals, but must carry a visible `Likely on-chain
OTC` label and link to their evidence. Corroborated rows receive a distinct label. Methodology and
aggregate displays must make the inferred component measurable rather than silently blending it.

## First post-scan evaluation

Run three interleaved lanes so one cohort cannot consume the review queue:

1. all eligible sends of historically valuable scarce assets, starting with FDCARD, SATOSHICARD,
   RAREPEPE, and other high-evidence assets;
2. round XCP and PEPECASH sends, used only for search priority;
3. the existing 800 clean, non-mechanical XCP/PEPECASH bilateral candidates, checking whether Bitcoin
   evidence corroborates or contradicts the token-for-token interpretation.

Report candidate count, unique BTC transactions, BTC and execution-day USD consideration, timing
tiers, ambiguity rate, same-owner risk rate, and manually reviewed precision. Those measurements
determine whether the public panel launches and whether any subset is eligible for corroborated OTC
volume.

## Incremental census implementation

The first automated pass ran while the historical Bitcoin scan was still active. Completeness is
bounded by the durable `scan_state` watermark rather than by wall-clock time or the node tip.

Reproducible commands:

1. `import-otc-ledger-export.mjs` converts the purpose-built D1 SQL export into indexed local SQLite
   staging. This is a rebuildable snapshot, not a production authority.
2. `build-local-otc-census.mjs` attaches the ledger snapshot and compact Bitcoin index, reads the
   durable Bitcoin checkpoint, and materializes eligible deliveries, structural matches, unique
   candidates, and admitted repeat-price lanes.
3. `export-local-otc-admitted-sql.mjs` emits idempotent evidence and `trades` upserts for D1.

Automated admission version 1 requires all of the following:

- a direct BTC flow from asset recipient to asset sender between 24 blocks before and three blocks
  after delivery;
- at least 1,000 sats of observed consideration;
- no multi-payer, self-flow, or unknown-external-input attribution flag on the seller payment;
- an observed change flow back to the payer;
- the BTC payment transaction is not itself a Counterparty protocol transaction;
- exactly one candidate payment for the delivery and exactly one candidate delivery for that payment;
- neither endpoint is a known exchange, deposit, burn, Emblem vault, or registered Swapbot;
- the delivery is not already a known market trade leg;
- the asset/seller lane contains at least three candidates and at least two distinct buyers; and
- the row's BTC-per-unit price is between 0.80x and 1.25x that lane's median.

The first pass through block 730,303 considered 912,589 eligible deliveries. After protocol-payment
exclusion it found 8,977 unique structural candidates and admitted 3,321 repeat-price-lane rows.
Together with two non-overlapping manually validated proof rows and one overlapping proof row,
production contains 3,323 OTC trades: 146 assets, 2,321 buyers, 158 sellers, 1,884.00164304 BTC, and
$4,959,946.74 of known execution-day USD across 3,226 priced rows. Every production OTC row has one
evidence row; no evidence/trade orphans or duplicate event/payment pairs were present after import.

The remaining isolated candidates and lane-price outliers stay in the local census for later review.
They are not silently discarded and are not included in production volume.

## Production algorithm version 2

The final pre-production gap audit tested narrower timing, wider timing, global and local price
bands, two-observation lanes, split wallets, split payments, bundle deliveries, same-block ordering,
and relaxed payer/recipient identity. Version 2 admits six mutually exclusive methods in priority
order. A Bitcoin payment transaction and a Counterparty delivery event can each belong to at most
one admitted trade.

1. `direct_btc_for_counterparty_asset`: version 1's unique recipient-to-sender payment, three-match
   lane, two-buyer minimum, and 0.80x-1.25x global-median band.
2. `direct_btc_two_match_lane`: exactly two different buyers in the same asset/seller lane, with both
   unit prices no more than 25% apart. Both observations are admitted together.
3. `direct_btc_temporal_lane`: a globally rejected price is admitted only when a leave-one-out
   30-day median has at least three peer observations and at least two peer buyers other than the
   candidate buyer, using the same 0.80x-1.25x band.
4. `direct_btc_delayed_delivery`: payment may precede delivery by four through 24 blocks only when
   the canonical -24/+3-block lane already has at least 25 observations; delayed rows never influence
   the median used to validate themselves.
5. `split_wallet_btc_receiver`: the asset recipient pays BTC, but a recurring operational address
   distinct from the asset sender receives it. The `(asset, asset sender, BTC receiver)` lane needs
   three observations, two buyers, unique +/-1-block pairing, and stable unit prices. Production
   low-quality assets are excluded because the seller identity link is relaxed.
6. `split_btc_payments`: every unambiguous direct BTC payment for one delivery is summed, all payment
   legs must map only to that delivery, and the aggregated price must pass a three-match/two-buyer
   lane. Every BTC leg is stored in `otc_trade_payments`.

Rejected after the final audit:

- one payment for multiple asset deliveries: 1,351 bundles and 5,514 asset legs were visible, but
  allocating the $1.23 million payment total among individual assets would be invented data;
- a BTC payer different from the asset recipient: plausible cases exist, but timing does not restore
  the lost buyer identity strongly enough for automated volume;
- blanket wider price or timing bands, which admitted obvious mismatches and destabilized lane
  medians;
- ambiguous multi-payer/external-input flows and any reuse of one BTC payment across two trades.

The version 2 reconciliation through Bitcoin block 748,599 completed on 2026-07-23. Production holds
4,059 OTC trades including two preserved manually reviewed version 1 rows: 249 assets, 2,643 buyers,
1,984.30105793 BTC, 3,949 USD-priced trades, and $5,180,409.66 known execution-day volume. There are
4,059 evidence rows and 4,068 BTC payment legs, with zero orphan rows, duplicate delivery events,
duplicate payment assignments, or evidence/payment-total disagreements.

The incremental census through durable Bitcoin block 801,103 completed later on 2026-07-23. After
rebuilding all version 2 lanes and the separately reviewed version 3 one-off cohort, production holds
5,421 OTC trades: two preserved manual version 1 rows, 4,419 version 2 rows, and 1,000 version 3 rows.
The increment added 18 trades (two repeat-lane and 16 one-off), eight assets, 0.01147881 BTC, and
$540.49 of known execution-day USD. The resulting authority covers 689 assets, 3,080 buyers, 1,032
sellers, 2,017.49544056 BTC, and $5,596,344.20 across 5,311 USD-priced rows. Post-import checks again
found zero trade/evidence orphans, duplicate delivery events, duplicate BTC-payment assignments, or
payment-total disagreements.

## Bundle admission, version 4 (2026-07-27)

Method `bundle_btc_payment` admits one BTC payment paired with several asset deliveries between
the same buyer and seller. Consideration attaches to the bundle: the canonical row is
`trades(venue='otc', sale_class='bundle')` with `asset_id` NULL, one `trade_legs` row per
delivered asset, one evidence row, and one payment leg. No per-asset price is ever invented, and
bundle rows never feed per-asset volume, unit-price lanes, or reference prices.

Screens, each validated by a reviewed case before adoption:

1. Infrastructure endpoints (exchange, deposit, burn, vault, service) are excluded.
2. Repeated reciprocal BTC flow between the pair rejects custodial shuttles and service orbits.
   The screen ignores legacy Counterparty send-dust below 10,000 sats: old-style sends carry
   5,430-sat outputs to the recipient, which are protocol mechanics rather than payments. This
   screen alone quarantined a 91 BTC "payment" between two unlabeled custodial wallets with more
   than 5,500 mutual transfers — a $7.96M distortion had it been admitted.
3. A payment above 100x the summed 180-day market medians of the priceable legs is rejected as a
   coincidental mispair (a 0.5 BTC payment "for" 420 PEPECASH measured 5,900x). Real collectible
   lots routinely clear 2x-40x over thin dispenser medians and are deliberately not rejected: a
   reviewed 14-card rare-pepe lot at 23x ($196,608) is genuine, as is a reviewed artist sale at
   39x. The ratio is a mispair detector, not a market-price validator. A repeat-price bundle lane
   overrides the mispair rejection: the same seller shipping the same asset composition to at
   least three bundles across at least two independent buyers within a 25% payment spread is the
   two-match-lane evidence class, and the stable realized price outranks a thin median (five
   independent buyers paid ~$490 each for NEWPEPEDESU bundles whose median claimed $2).
4. Buyer forwarding bundle assets into registered Emblem vaults shortly after delivery upgrades
   confidence to `corroborated`. The founding case is the 7.3055 BTC GODANUBIS/GODDESSISIS pair:
   an exchange withdrawal funded the buyer wallet in the delivery block, the tagged-merchant
   seller had restocked both cards from the series artist 140 blocks earlier, and each card was
   wrapped into its own registered Emblem vault within 20 blocks of payment.

`build-local-otc-bundles.mjs` is the single reproducible process: it materializes bundles from
the census, classifies every one with an audited verdict row (admitted or not), and emits
idempotent D1 upserts for the admitted set.

## Escrowed payment lane (designed, not yet built)

Third-party escrow can restore buyer identity for cohorts rejected earlier. The detectable shape
is the two-hop path: buyer pays escrow, escrow pays seller, delivery falls between the legs.
Qualifying tests: amount conservation minus a consistent fee; the escrow address recurring across
disjoint buyer/seller pairs (multi-tenancy distinguishes an agent from someone's second wallet);
no Counterparty persona on the escrow address; and dwell time between deposit and release
conditioned on the delivery confirming. The previously rejected third-party-payer cohort becomes
admissible exactly when the payer received a matching amount from the asset recipient shortly
before paying the seller. Behaviorally discovered escrow agents surface as review candidates and,
once reviewed, become curated `escrow` tags like the vault tags that corroborated the god-card
case.

## Whole-address sweep purchase survey

A separate ledger-only hypothesis test evaluated whether a buyer paid BTC to an address owner and
then received the address's Counterparty contents through `SWEEP`. Through Bitcoin block 802,103,
1,453 valid sweeps existed and 871 were covered by the compact Bitcoin watermark. The initial
-24/+3-block structural join found 111 unique sweep/payment pairings, of which 79 avoided known
exchange, deposit, burn, and Emblem endpoints. These are not automatically sales: 68 of the 79 used
a source input in the sweep transaction exactly equal to the supposed BTC payment. They are sweep
fee funding transactions and must be rejected, not counted as consideration.

Only one presently strong purchase-shaped case survived the first behavioral review. Sweep
`20145f90e5f9db397a6381ca9cff97ced83ae2af98895018fef5720a48f40af0` moved 24 positive-balance
assets (plus ownership records) from `1CxjbeMnP2YHe4pR4dKkHh21Mc21rSmkSg` to
`14xJqdZXuQycTutvqCB8ksq9HLwaSFKZgF`. One block later, the destination paid the source 0.0026 BTC in
`13e620cd55830a66435a778f83a179133ee73c8ef8115c9c0f404ce1a6ac8d59`, approximately $72.34 at the
reviewed daily BTC/USD price. The payment was unique between the pair, did not fund the sweep input,
and had no reverse-flow history in the indexed graph. It remains a likely whole-address OTC bundle
candidate, not yet production volume. Other apparent post-sweep cases showed repeated bidirectional
BTC relationships or immediate fee/reimbursement behavior and were rejected at this stage.
