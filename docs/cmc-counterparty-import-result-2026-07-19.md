# CMC Counterparty historical import result

The initial official CoinMarketCap historical-listings acquisition retained 3,726 unique UTC days from 2014-02-15 through
2024-04-28. The archive contains 20,922 target observations and has SHA-256
`933517fc154b7bc56c6a4ef0f2c421e067c14f4383550098980bc12a66a1ff54`. The insert-only import added **16,776**
previously absent observations: **14,506 Counterparty-asset price days** and **2,270 BTC price days**. Existing rows,
including the existing XCP history, were not overwritten.

A subsequent identity-bounded COVALC acquisition added **1,027** observations from the canonical Counterparty first
issuance day, 2016-08-07, through 2019-05-30. Its separate archive has SHA-256
`16ec0ac064c9baff000f49abd46b42cbab1adc1fd6b3f7fcd844793c57f5fd4d`. Combined, the two imports added **17,803**
previously absent observations, including **15,533 Counterparty-asset price days**. No post-delisting Ethereum COVAL
observation was assigned to COVALC.

## Coverage and downstream reach

“Knock-on matches” below means completed Counterparty DEX order matches where the named asset is one payment leg, the
other leg is neither BTC nor any listed bridge asset, and an exact-UTC-day CMC USD observation exists. It measures
technically convertible historical payments without double-counting bridge-to-bridge trades. It is not an admission
decision under `usd-payment-v1`.

| Asset | CMC USD price days in DB | Observation window | Knock-on matches | Match days | Other assets |
| --- | ---: | --- | ---: | ---: | ---: |
| XCP | 4,535 | 2014-02-15–2026-07-18 | 91,870 | 3,817 | 4,897 |
| FLDC | 1,863 | 2014-09-16–2019-11-04 | 2 | 1 | 1 |
| SJCX | 1,829 | 2014-08-20–2019-09-10 | 21 | 12 | 3 |
| BITCRYSTALS | 1,936 | 2015-09-14–2021-01-06 | 9,181 | 1,048 | 359 |
| LTBCOIN | 986 | 2014-08-20–2017-10-26 | 7 | 7 | 4 |
| GEMZ | 822 | 2015-01-12–2017-05-21 | 35 | 11 | 1 |
| PEPECASH | 1,579 | 2016-09-29–2023-05-12 | 39,599 | 1,180 | 2,026 |
| DATABITS | 838 | 2017-03-30–2019-07-15 | 0 | 0 | 0 |
| COVALC | 1,027 | 2016-08-07–2019-05-30 | 0 | 0 | 0 |
| TRIGGERS | 753 | 2016-10-11–2018-11-02 | 0 | 0 | 0 |
| SCOTCOIN | 959 | 2014-05-26–2017-06-30 | 1 | 1 | 1 |
| ZAIF | 162 | 2016-04-08–2016-10-22 | 0 | 0 | 0 |
| SWARM | 713 | 2014-09-16–2016-09-15 | 14 | 7 | 2 |
| TILECOINX | 1,066 | 2014-10-25–2017-10-21 | 0 | 0 | 0 |
| CICC | 0 | — | 0 | 0 | 0 |

Excluding XCP, whose history was already available, the new aggregate observations make **48,860 completed matches**
exact-day priceable in this deliberately non-bridge-counterpart census. PEPECASH contributes 39,599 and BITCRYSTALS
9,181; the remaining six supported lanes contribute 80.

For PEPECASH, a broader comparison against the already frozen strict candidate regime finds 39,600 CMC-reachable
matches, of which 11,160 were not reachable under the strict regime; 28,440 overlap and 269 remain strict-only. This
comparison uses the broader PEPECASH census definition, so it differs by one match from the non-bridge table above.

## Boundaries

- COVALC is bounded to its independently corroborated Counterparty era. Four completed COVALC/XCP matches in 2017
  have exact-day COVALC observations, but they are bridge-to-bridge corroboration and therefore excluded from the
  knock-on census. A fifth COVALC/XCP match in 2024 is post-migration and deliberately unsupported by this series.
- CICC has no verified CMC identity.
- The acquired BTC observations do not fill any currently missing BTC-denominated trade day; they improve retained
  source coverage but add zero BTC knock-on matches.
- A CMC historical listing is a daily market aggregate, not a reconstructed Poloniex, Bittrex, or other venue quote.
- These rows remain source observations. Selection for displayed historical USD values still requires a documented
  policy decision, overlap diagnostics, and explicit confidence/provenance labeling.
