# Tokenly Swapbot reconstruction survey — 2026-07-19

## Conclusion

The historical vending service was **Tokenly Swapbot**, not Tokenly Pockets. Pockets was a
self-custodial Chrome wallet. Swapbot is a defensible named venue: each operator-funded bot had a
vending address, accepted BTC or Counterparty assets, and sent a configured output asset back after
confirmations. It should be represented specifically as `Tokenly Swapbot`, never as evidence for a
generic `service address` class.

## Primary and corroborating evidence

- Tokenly's own Tools and Services repository describes Swapbot as a multi-bot token vending system:
  BTC or a Counterparty token enters a vending address and a different token exits after confirmations.
  It supported fixed, API-derived, broadcast-derived, and custom-function prices.
- The open-source `tokenly/swapbot` implementation stores a distinct bot `address`, consumes XChain
  payment notifications, resolves the customer from the transaction source, sends the output to that
  customer, and contains explicit confirmation, refund, out-of-stock, and income-forwarding states.
- Tokenly's GitHub issue archive contains 245 issues and 330 comments. Issues document real production
  bot URLs, payment/refund failures, BTC-fuel requirements, and the limitation that a different recipient
  could not normally be specified. This supports same-source return matching.
- Counterparty forum and Bitcointalk records publish bot URLs, accepted assets, quoted rates, transaction
  hashes, and several vending addresses.
- The local Counterparty Telegram export explicitly calls Swapbots the predecessor to dispensers and
  records operator use of BTC, XCP, BITCRYSTALS, FLDC, SJCX, and sometimes PEPECASH.

## Confirmed example addresses

| Address                              | Evidence                                        | Initial chain result                                                                                   |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `12sfan5Kf1X1o3WcyfGiWberCkgrveGF74` | Published Mountaingox/GOXCARD bot address       | 77 payment events, 68 buyers and 84 BITCRYSTALS → GOXCARD delivery legs, 2015-10-29 through 2016-03-04 |
| `12xu92LhzgRv8ZH4ZhsqTkfXiKE4DaVMFX` | Published SoG card bot address and buyer report | 64 payment events and 64 clean cross-asset delivery legs across 35 buyers                              |
| `15LSRtvFUqyRnYeFMYFb9bBfF9AHRvJqbw` | Published FootballCoin ICO Swapbot address      | At least 996 XFCCOIN outputs; BTC-input matching is required                                           |
| `14dY2URUEteMkYieEyr4vNANusReqv7nrC` | Tokenly production issue screenshot/data        | 32 Counterparty sends; role needs individual review                                                    |

The pairing counts above are exploratory lower bounds. They require an incoming Counterparty send to
the documented bot followed by a different asset from the bot to the same source within 12 blocks.
Refunds, inventory moves, owner withdrawals, and BTC-input purchases are intentionally not counted.

## Canonical-send audit and repair

The historical sends were present in the compact database's canonical `source_id` and `destination_id`
columns. A newer address-signal query incorrectly consulted only the optional UTXO-resolved address
columns, which are null for regular, enhanced, and MPMA sends. The query now uses the canonical IDs with
resolved IDs as an optional override. The sampled Swapbot histories and address activity are visible
without creating a venue-specific shadow copy.

## Observable ledger signature

The Counterparty ledger exposes a strong, dispenser-like transaction signature:

1. a customer sends payment asset `P` to a documented bot address;
2. after confirmations, that address sends different asset `A` back to the same customer; and
3. all delivery legs belonging to the payment occur in a short bounded window.

Across six confirmed or high-confidence candidate bot addresses, a 12-block exploratory matcher finds
2,225 payment events, 2,555 output legs, and 242 multi-leg payments. The typical first delivery is about
three blocks after payment. The two largest candidate hubs show coherent commercial lanes rather than
arbitrary transfers: one repeatedly exchanges BITCRYSTALS for named Spells of Genesis cards and another
does the same in tightly bounded card-release periods. This repeated direction, same-customer return,
short delay, and coherent asset-lane structure is substantially more specific than address fan-in/fan-out.

Multi-leg results must be stored as one sale with child delivery legs. Counting every child as a complete
sale would duplicate the payment and inflate volume. The parent sale owns the input quantity and USD
value; legs record delivered assets and quantities. When a historical configuration does not specify a
bundle allocation, the total can be shown for the sale but must not be assigned independently to every
asset leg.

## Defensible reconstruction contract

Classify an observation as a Tokenly Swapbot trade only when all of the following hold:

1. The bot address is tied to Tokenly Swapbot by a first-party page/repository/API artifact or a
   contemporaneous public bot URL plus address/transaction evidence.
2. The incoming payment is observed on Bitcoin or Counterparty, not inferred from a later output alone.
3. The outgoing asset is sent from that bot to the payer's source address within the bot's operational
   confirmation window.
4. The input and output assets differ. Same-asset returns are refunds, not volume.
5. Each input is used once. Multiple outputs may attach to one input as bundle legs; ambiguous overlap
   between two possible input payments is withheld unless a historical quote/configuration resolves it.
6. Inventory funding, income forwarding, shutdown sweeps, issuance, and refunds are excluded.
7. Venue is `Tokenly Swapbot`; operator/bot slug is retained separately when known.

USD value should use the execution-day USD value of the payment asset under the existing price policy.
BTC payments are the strongest case. XCP, BCY, FLDC, SJCX, GEMZ, and PEPECASH payments are only valued
where the payment asset already has an accepted daily USD price; otherwise the trade remains real with
null USD value.

## Recommended sequence

1. Build a cited bot registry from Tokenly issues, forum posts, Bitcointalk, local chats, archived bot pages,
   and the former TokenRank/Swapbot API if recoverable.
2. Implement a read-only, parent-and-legs matcher and publish ambiguity/refund/inventory diagnostics before
   importing. Use configuration-specific confirmation windows when recovered and a documented sensitivity
   range otherwise.
3. Add Bitcoin input/output matching for confirmed bot addresses, preserving exact satoshi payment value.
4. Import only the clean matched cohort as venue `tokenly_swapbot`, then report trades, native volume, USD
   coverage, withheld candidates, and sensitivity to the confirmation window.
