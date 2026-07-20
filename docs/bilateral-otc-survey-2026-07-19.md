# Bilateral OTC reconstruction survey — 2026-07-19

## Question

Can a payment followed by a return asset delivery identify historical OTC trades that were never
recorded by the DEX, dispensers, or an attributed marketplace?

## Counterparty-token test

The exploratory test starts with XCP or PEPECASH sent from address A to address B. It looks for a
different Counterparty asset sent from B back to A within 12 blocks. It then requires a strict
one-to-one match: the payment must have only one possible delivery and the delivery only one possible
payment. Known exchanges, burn addresses, Emblem vaults, and documented Tokenly Swapbots are excluded.

This is an atomic-looking bilateral exchange, not proof of a sale. It can still represent a gift,
repayment, inventory movement between one owner’s wallets, informal swap, or coincidental timing.

## Initial census

| Behavioral cohort                                      | Matches | Sellers | Buyers | Execution-day USD coverage |     USD sum |
| ------------------------------------------------------ | ------: | ------: | -----: | -------------------------: | ----------: |
| Bilateral candidates (one buyer, at most five matches) |     438 |     391 |    321 |                        415 | $201,508.68 |
| Mixed behavior                                         |     372 |     105 |    211 |                        351 | $257,865.26 |
| Mechanical vendors                                     |     215 |       8 |    106 |                        215 |   $7,394.69 |

The cohort names are descriptive filters, not classifications suitable for import. In particular,
“bilateral candidate” means only that the seller address does not look like a many-customer vending
service in this matched sample.

Several of the largest bilateral observations are economically plausible:

- 9 PEPEPEACOCK for 1,770 XCP on 2021-11-21;
- 1 FAKAMOTO for 600 XCP on 2021-10-06;
- 2 TREZORCD for 2,096 XCP on 2016-09-23;
- 1 BENDERPEPE for 360 XCP on 2021-09-22; and
- 3 PEPEDARK for 100,000 PEPECASH on 2017-11-23.

The FAKAMOTO observation is directionally corroborated by later local chat describing its last sale
as approximately $9,000, but that does not yet identify the exact counterparties or quote. It remains
a candidate.

## Full XCP and PEPECASH ledger census

The primary census now uses the complete Counterparty ledger and treats BTC matching as a later
enrichment. It requires an XCP or PEPECASH payment from buyer to seller followed within 12 blocks by
a different asset sent from seller back to buyer. Both sides must have exactly one possible match.
Known exchanges, burns, Emblem vaults, documented Swapbots, and deliveries already represented by a
known trade leg are excluded. No Telegram or other off-chain evidence is used for discovery.

| Quote | Peer-like | Repeat/mixed | Mechanical | Non-mechanical |
| --- | ---: | ---: | ---: | ---: |
| XCP | 453 | 142 | 188 | 595 |
| PEPECASH | 167 | 48 | 27 | 215 |
| Total | 620 | 190 | 215 | 810 |

The 810 non-mechanical candidates cover 581 distinct purchased assets before deduplication across
quote currencies. All 595 XCP candidates have execution-day USD conversion and sum to $400,903.54.
Of 215 PEPECASH candidates, 171 have execution-day USD conversion and sum to $58,470.39. The combined
known consideration is therefore $459,373.93, with 44 PEPECASH candidates intentionally left without
a USD value.

The low-quality-asset flag has little effect on this result. It removes 10 XCP candidates across
seven assets and $6,984.41 of known consideration. It removes no PEPECASH candidates. The clean-asset
view is 800 candidates and $452,389.52 of known consideration.

Timing supports a real exchange signal but does not prove every row. Of the clean non-mechanical
candidates, 524 of 800 complete within three blocks: 366 XCP and 158 PEPECASH. Same-block completion
is common, while the remaining tail through 12 blocks is weaker. A useful presentation can therefore
show the full strict census while marking 0-3 blocks as the tighter timing tier.

This is a substantially better OTC *view* than the earlier BTC-first sample, but it is not yet honest
to add all 810 rows to canonical realized volume. `Peer-like`, `repeat/mixed`, and `mechanical` are
behavioral cohorts rather than truth labels. The next evaluation should test same-owner behavior,
reciprocal inventory transfers, repeated round quantities, and price plausibility asset by asset.
Bitcoin ledger matching can then corroborate unmatched or higher-value cases without blocking this
fast Counterparty-ledger census.

## BTC-first test

The ledger-only survey now starts with Counterparty sends of clean assets that have demonstrated
realized value, then reads the Bitcoin ledger for a direct payment from the asset recipient to the
asset sender. Telegram evidence is not used. Exchange, burn, Emblem-vault, self-send, and documented
Swapbot delivery addresses are excluded before Bitcoin lookup.

The early-period pilot lowered the asset screen from $500 to $25 of historical realized value. The
screen only prioritizes assets; it does not assign that historical value to the candidate send. Among
100 sends through block 400,000, eight high-activity recipients were withheld and three sends had a
direct BTC transfer between the counterparties:

| Asset | Quantity | BTC payment | BTC timing | Result |
| --- | ---: | ---: | ---: | --- |
| XAJIBASILAAR | 1 | 0.05000000 | 5 blocks before | unique candidate |
| XCP | 5.80359040 | 0.00620790 | 15 blocks before | unique candidate |
| BLOCKSIZECD | 1 | 0.00050000 nearest | 1 block before | ambiguous: three payments in window |

Both unique payments spend only inputs controlled by the asset recipient, pay the asset sender, and
return change to the payer. At the 2016-02-24 BTC/USD close of $423.94, their observed consideration
is approximately $21.20 and $2.63. This illustrates why a $500 candidate threshold is inappropriate
for early Counterparty history.

These are credible ledger-only OTC candidates, but the pilot is not a census. Direct payment and
delivery can still be transfers between wallets under common control. The ambiguous BLOCKSIZECD
relationship also demonstrates why nearest-in-time alone is insufficient. A production admission
rule should require a unique direct BTC payment in a tight window, explicit change back to the payer,
no infrastructure tags, no competing deliveries or payments, and a same-owner/repeated-flow check.
The two unique candidates remain outside canonical volume until that rule is evaluated across broader
block-stratified samples.

### BTC search priority

The BTC follow-up is now divided into three interleaved lanes so XCP cannot consume the entire search
budget: round XCP sends, round PEPECASH sends, and other clean assets prioritized by trading history
and maximum realized trade value. Examples such as 100, 500, 1,500, or 10,000 XCP and 100,000 or
1,000,000 PEPECASH rank ahead of irregular quantities. Roundness controls search order only and is
never evidence that a payment occurred.

Counterparty API v2 is now the first Bitcoin-history provider. Its
`/v2/bitcoin/addresses/{address}/transactions` response includes decoded inputs, previous outputs,
outputs, and block status, but it is capped at the newest 50 transactions and has no pagination.
Those 50 rows are sufficient for low-activity addresses or recent target windows. When they do not
reach the candidate block, the survey falls back to paginated Electrs history. In the balanced
12-send pilot this reduced Electrs work from 36 requests to 19, with 11 fast Counterparty API calls;
the result remained identical.

A 12-send balanced pilot found one unique direct payment: 100,000 PEPECASH sent in block 449,334 and
0.00100989 BTC paid between the same counterparties in that block, two transaction positions before
the asset delivery. The BTC transaction spends only the asset recipient's input, pays the asset
sender, and returns change to the payer. At the
2017-01-21 BTC/USD close of $925.06, the consideration is approximately $0.93.

The search is now asset-first rather than block-first. Clean assets receive a combined evidence score
from trade count, maximum realized trade value, and holder breadth. A fixed number of sends is taken
from each ranked asset, with round XCP and PEPECASH quantities prioritized inside their own queues.
This prevents either recent blocks or a single hyperactive asset from consuming the lookup budget.

The first top-20 asset pass evaluated 58 sends across XCP, PEPECASH, BITCRYSTALS, SJCX, FLDC,
SCOTCOIN, BITCORN, and other high-evidence assets. It found one unique direct payment: 20 SJCX for
0.00013165 BTC in block 904,809. The BTC payment appears six transaction positions before the SJCX
delivery and pays the asset sender directly. Protocol pseudo-asset BTC is excluded from future asset
queues.

Sampling is no longer the terminal rule for the highest-value assets. FDCARD, SATOSHICARD, and
RAREPEPE are being evaluated across every eligible send before moving down the ranking. The earlier
1,500-Bitcoin-transaction address cutoff was operational, not a quality label, and has been removed
for these exhaustive passes. Deep histories now paginate up to the configured page ceiling; failures
are retained explicitly for retry.

The first 480 FDCARD sends processed contain 35 sends with at least one direct BTC transfer and 31
with a unique transfer in the original 1,008-block window. There are 42 distinct BTC transaction IDs
across all matched windows, so raw BTC must not be summed as sale volume yet. Within a much tighter
12-block window there are 19 uniquely attributable sends and 17 distinct BTC transactions. Several
large historical transfers (3, 7.2, 8, and 8.15 BTC) require same-owner and price-plausibility review
before they can be considered sales. Forty-five incomplete rows from the earlier cutoff/provider
failures remain on the retry list.

## Admission rule

Do not add an on-chain-only bilateral candidate to realized trade volume. Admit it as `otc` only when
independent contemporaneous evidence identifies the same asset, consideration, and transaction or
the same two counterparties within a sufficiently precise time window. Suitable evidence includes an
auction result, chat acceptance message, published transaction hash, signed quote, or marketplace
record. Asset-and-price hearsay without counterparty or transaction linkage is supporting context, not
enough for admission.

Confirmed OTC records should preserve both transaction hashes, evidence source, evidence timestamp,
and an explicit confidence grade. USD value belongs to the observed payment side at the execution-day
price. On-chain candidates can be reported as research coverage but must remain outside market cap,
volume, last-sale, and portfolio valuation inputs.
