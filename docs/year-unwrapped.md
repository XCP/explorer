# Year Unwrapped — content scratch pad

Working notes for the `/year/[year]` pages ("Counterparty Unwrapped", 2014–2026). Content only —
no design. Everything below is from the prod mirror (`xcpio-core`), queried 2026-07-19/20, unless
marked *(context — verify)*. 2026 figures are partial (through ~Jul 19).

**Measures glossary** (use the same definitions on every page):

- **raw** — everything in the mirror's `trades` for a venue; the tape as it printed.
- **clean** — raw filtered to `asset_signals.low_quality = 0`; what we're willing to celebrate.
- **venues** — dex, dispense, emblem, scarce.city, telegram, tokenly_swapbot; CEX volume lives
  separately in `market_price_observations` (only Zaif is attributable).
- **actors** — distinct tx source addresses in the year. **newcomers** — addresses whose
  first-ever Counterparty tx is in the year.
- **cards born** — collection members whose *first issuance* falls in the year. Caveat: membership
  evidence can adopt assets issued before a collection existed (a 2015-registered asset can be a
  2021 Fake Rare). For "born in year X" claims, pair first-issuance with same-year activity.

**Master table** (raw DEX = venue 'dex' unfiltered; clean $ = all venues, quality-filtered):

| Year | Txs | Actors | Newcomers | New assets (issuers) | Raw DEX fills / $ | Clean $ all venues | XCP open→close (hi) |
|---|---|---|---|---|---|---|---|
| 2014 | 134,093 | 13,513 | 13,513 | 7,074 (696) | 3,610 / $252k | $193k | $0.54→$4.03 ($9.41) |
| 2015 | 265,335 | 13,684 | 11,684 | 36,552 (1,139) | 3,476 / $48k | $51k | $3.98→$0.60 ($3.98) |
| 2016 | 351,843 | 20,871 | 16,824 | 18,778 (1,382) | 20,306 / $1.19M | $607k | $0.61→$1.72 ($5.60) |
| 2017 | 401,390 | 39,696 | 33,987 | 8,412 (1,472) | 49,811 / $16.2M | $3.3M | $1.92→$32.86 ($36.33) |
| 2018 | 253,180 | 21,423 | 16,822 | 3,610 (801) | 29,735 / $7.0M | $868k | $32.15→$2.10 ($88.93) |
| 2019 | 76,177 | 13,362 | 11,117 | 1,112 (185) | 5,612 / $197k | $120k | $2.20→$1.44 ($3.56) |
| 2020 | 58,475 | 3,705 | 2,556 | 493 (111) | 10,872 / $98k | $153k | $1.47→$1.11 ($2.08) |
| 2021 | 294,773 | 13,446 | 10,939 | 15,818 (818) | 35,748 / $26.4M | $163.6M | $1.12→$10.07 ($27.38) |
| 2022 | 374,190 | 21,647 | 16,642 | 29,884 (1,544) | 20,331 / $5.4M | $47.2M | $10.65→$2.58 ($14.91) |
| 2023 | 409,346 | 63,818 | 59,041 | 83,093 (9,868) | 8,287 / $1.3M | $30.8M | $2.58→$4.27 ($5.05) |
| 2024 | 363,066 | 21,703 | 16,634 | 34,751 (2,521) | 2,103 / $746k | $10.8M | $4.11→$7.28 ($12.51) |
| 2025 | 122,667 | 7,167 | 4,150 | 6,544 (354) | 3,326 / $116k | $5.9M | $7.12→$1.93 ($9.00) |
| 2026* | 44,318 | 2,674 | 1,280 | 9,423 (207) | 2,120 / $52k | $1.0M | $2.01→$1.49 ($2.12) |

**Sale of the year** (biggest single clean fill, ≤10 units, collection members — the ladder is a
story on its own, and its settlement currency traces the money arc):

| Year | Card | Price | Paid in |
|---|---|---|---|
| 2014 | POKEMON | $166 | BTC |
| 2015 | FDCARD | $259 | XCP |
| 2016 | SATOSHICARD | $3,712 | XCP |
| 2017 | MODERNPEPE | $11,627 | PEPECASH |
| 2018 | CLUBPEPE | $8,448 | XCP |
| 2019 | SATOSHICARD | $4,426 | BITCRYSTALS |
| 2020 | SATOSHICARD | $870 | BITCRYSTALS |
| 2021 | PEPEMILLION | $896,411 | BTC |
| 2022 | PEPEALASSAD | $682,224 | BTC |
| 2023 | WINKELPEPE | $632,728 | BTC |
| 2024 | RAREPEPE | $176,019 | BTC |
| 2025 | SATOSHICARD | $54,090 | BTC |
| 2026* | DARKPILLPEPE | $23,359 | ETH |

SATOSHICARD is sale-of-the-year four times across a decade — the evergreen grail.

---

## 2014 — The Burn

- **2,125.6 BTC burned by 2,354 addresses in one month** (Jan 2 – Feb 2) → 2,649,791 XCP. The
  founding sacrifice; no premine, no ICO — provable destruction. Opens every version of this story.
- XCP's first price: $0.54, spiking to $9.41 within the year, closing $4.03.
- **The BTC DEX actually worked here**: BTC was the #1 traded "asset" ($83k) — order matching against
  real bitcoin, before fees killed it. The rest of the top list is proto-securities: SJCX (Storj ran
  on Counterparty). (MPTSTOCK/MPBTC — the Multipool tokens, $40.5k combined — were owner-flagged
  low quality 2026-07-20: one seller into 34 buyers at the era's infamous prices; 2014 clean is
  now $211k.)
- Protocol was a toybox: RPS (rock-paper-scissors) enabled Jun 29; betting live; Counterparty Bitbowl
  cards (Super Bowl prediction assets, 32 cards) — gambling was the first culture.
- **Betting was a 2014-only phenomenon: 1,105 bets** — then 0 in 2015, a last gasp of 28 in 2016,
  16 in 2017, none since. And 1,830 btcpays (the working BTC DEX) collapsed to **11** in 2015.
- **7,208 broadcasts** — the chattiest year on the chain until 2023 — because bets needed oracle
  feeds. The broadcast layer was born as a sportsbook wire.
- First card sale ever recorded: POKEMON, $166 in BTC, Apr 13. *(fun to verify the asset's art survives)*
- Numeric assets + multisig arrived Dec 9.
- The Wall Street ambition was not a metaphor: **Overstock's Medici project set out to build a
  licensed stock market on Counterparty** (Oct 2014, forum thread of the era), Let's Talk Bitcoin
  planned LTBCOIN here, XCPBOND promised "0.03 XCP (3%) monthly fixed dividend," and JPBULL/JPBEAR
  offered leveraged BTC bets. Also the first exchange incident: **6,171 XCP taken from Poloniex
  (Feb 2014), covered by community donations** — crypto's oldest ritual, performed early.
  *(primary source — forums)*
- **The announcement and the first burn share a date**: the bitcointalk thread ("[ANN][XCP]
  Counterparty — Pioneering Peer-to-Peer Finance") went up January 2, 2014 at 3:51 PM — the same
  day the burns table records its first burn. Founding self-image, verbatim: "Unlike Wall Street…
  Counterparty aims to democratize finance." **They thought they were building Wall Street; they
  built a card table.** The gap between that sentence and 2022's "rare pepe scientist dinner" is
  the whole thirteen-year arc. *(primary source)*
- **vs BTC**: XCP +646% in a year Bitcoin fell 59% — the biggest relative outperformance in the
  whole ledger. *(data)*
- **Meanwhile, outside**: the burn closed Feb 2 — **Mt. Gox froze withdrawals five days later** and
  was bankrupt by month's end. And that July, Ethereum ran its crowdsale — selling ETH for BTC while
  Counterparty had just burned BTC for nothing in return. Two funding philosophies, same year.
  *(context — verify dates)*
- Angle: **origin myth**. The whole page can be the burn + what people did with brand-new powers.

## 2015 — The Flood and the First Winter

- **36,552 assets registered — 5× more than 2014 — by only 1,139 issuers** (~32 per issuer): the
  first spam/squatting flood, right after numeric assets shipped. **Only 394 of them ever traded —
  1.1%.** (This is the origin of the asset-age caveat: registered ≠ alive.)
- The flood paid rent: **17,756 XCP destroyed in registration fees — the all-time deflation record**
  for a single year. Spam burned more XCP than any boom ever did.
- The redemption comes later: TEDDY, CUPCAKE, CALENDAR, DINOSAUR — March 2015 single-word names —
  all slept ~6.6 years and woke the same week of Nov 2021 as "vintage" collectibles. Plant this
  seed on the 2015 page, pay it off on 2021's.
- Price collapsed $3.98 → $0.60 (−85%). Clean market: $51k all year. The first crypto winter.
- But the seeds: **Spells of Genesis begins minting** (44 cards) — game assets before "NFT" existed.
  FDCARD (Sept) = first Force of Will / game-card trade era. THE-COUNTERPART collection (190) active.
- SJCX (Storj) was the real economy: #1 traded asset.
- RPS quietly disabled Apr 13 — the gambling era ends.
- Ideas outran the protocol: **subassets were proposed on the forums in December 2015 — eighteen
  months before they activated** (May 2017). The year's most-read thread was the mobile wallet
  launch; the DEX needed a defense titled "The DEX — It's used and it's useful." *(primary source)*
- **vs BTC**: XCP −85% while BTC recovered +37% off its $178 winter bottom — the worst relative
  year in the ledger. *(data)*
- **Meanwhile, outside**: **Ethereum mainnet launched July 30** — the competitor arriving in
  Counterparty's worst year. Spells of Genesis was minting game cards here two-plus years before
  ERC-721 was even proposed. *(context)*
- Angle: **the flood vs the seeds**. Contrast junk volume with the handful of things that mattered.

## 2016 — The Frog Appears

- **Rare Pepe: 497 cards in its first four months** (born September). PEPECASH becomes the #1 traded
  asset ($74.6k, 1,669 fills). The meme economy starts here.
- Force of Will (161 cards) + Spells of Genesis (56) — the trading-card-game year.
- **Zaif ICO'd its own ZAIF token on Counterparty** ($34.3k DEX volume) **and listed XCP mid-year**
  — our attributable yen prints begin here (136 JPY trading days in 2016). Japan's decade-long
  relationship with XCP starts on this page.
- P2SH addresses activate Aug 6.
- The forums spent 2016 debating **EVM-on-Counterparty gas costs** ("EMVPARTY discussion", one of
  the all-time top threads) — running Ethereum's VM on Bitcoin was a live project here while
  Ethereum was recovering from The DAO. It never shipped; the cards did. *(primary source)*
- SATOSHICARD sells for $3,712 in August — the first four-figure card sale.
- XCP bottoms at $0.48 (the all-time cheap) then doubles into year end.
- **vs BTC**: XCP +182% vs BTC +123% (halving year) — a narrow win, the first of only four. *(data)*
- **Meanwhile, outside**: Ethereum spent the summer hacking itself apart (The DAO, June; the
  ETH/ETC split, July) **while Rare Pepe quietly invented the meme economy in September — nine
  months before CryptoPunks existed.** The precedence claim is the whole point; make it plainly.
  *(context — verify punks date)*
- Angle: **birth of the culture**. Everything 2017 monetized was invented here.

## 2017 — The Mania Year *(built — prototype exists)*

- XCP $1.92 → $32.86, peak $36.33 Dec 19; 17× vs Bitcoin's 14×.
- **Zaif's yen books: 532,299 XCP, $12.1M** — the one provable CEX lane. Japan everywhere: BitGirls
  talent tokens paying weekly HYOU dividends, HOMMALICOIN paying XCP, Memorychain (152 cards).
- Raw DEX record that still stands: 49,811 fills, $16.2M printed. Clean: 41,079 / $3.3M — the
  $12.9M gap is DIAMONDBOND/TROPTIONS-style wash. Raw-vs-real is the page's honesty device.
  (RRAM — $195k on 36 fills — was added to the curated lowq list 2026-07-20 after its 3-address
  ring pattern surfaced; its buyer=seller rate was only 3.7%, so the automatic ≥50% self-trade rule
  missed it. A ring-trade heuristic is a worthwhile future signal.)
- **PEPECASH became money**: #1 settlement currency by fills (24,209 vs XCP's 21,687; BTC: 4).
  Its VWAP did 228× ($0.0003 → $0.0685). BITCRYSTALS ran a third economy (3,295 fills).
- 2.46M XCP crossed the DEX ≈ 94% of supply turned over.
- Subassets born May 21 (126 by New Year's); enhanced sends Oct 15; 2,354 supply locks.
- 86% of actors were newcomers (33,987) — the first immigration.
- Rare Pepe's biggest year: 1,037 cards. FootballCoin 429.
- Fee squeeze: minting 1,225 (Feb) → 177 (Nov) as BTC fees exploded.
- The forums show both faces of the mania: a CIP burst (Segwit support, MPMA sends, three-letter
  asset names, and — in December — **"Decentralized Asset Sales," the dispenser idea 19 months
  before dispensers**) alongside a flood of tourist grief ("Counterwallet took 5 Bitcoins," stuck
  transactions, lost sweeps). *(primary source)*
- Sale of the year: MODERNPEPE $11,627 — *paid in PEPECASH*, on the year's busiest day (Jul 4).
- **vs BTC**: 17.1× vs 14.0× — XCP outran Bitcoin's most famous year. *(data — already on the page)*
- **Meanwhile, outside**: ICO mania raised billions on Ethereum; CryptoPunks appeared in June —
  nine months after Rare Pepe; and in December **CryptoKitties congested Ethereum the same weeks
  Bitcoin fees strangled Counterparty's mint** (our Nov trough of 177 new assets). Both chains
  choked on their own mania at once. *(context + data)*

## 2018 — The Morning After

- **XCP's actual all-time high is here: $88.93 on ~Jan 10** — then −93% to $2.10 by December. The
  2017 page must not claim the top; 2018 owns the ATH and the collapse. CLUBPEPE sells for $8,448
  the same week as the top — mania's last receipt.
- **Rare Pepe closes the book**: final 240 cards. The scene's response to the crash: new games —
  Mafia Wars (168), **Bitcorn born** (147) — play instead of speculation.
- Trading halves (raw $7.0M, clean $892k — after the 2026-07-20 owner flags on SCUDOCOIN and GALGO,
  which had carried $266k of 2018's "clean" tape). Telegram OTC appears as a venue (37 fills) —
  trust-based trading starts filling the CEX gap.
- **But Japan bought the crash: 2018 was Zaif's biggest XCP year ever — 1,655,898 XCP through the
  yen books, triple 2017.** While the West capitulated, the yen lane absorbed it. Sharpest
  contrarian fact of the year.
- Mid-crash, someone proposed on the forums to **"Re-open burn in perpetuity"** (June) — start the
  founding sacrifice again. It didn't pass; the instinct says everything about the year.
  *(primary source)*
- 3,610 new assets — quietest mint since 2013.
- **vs BTC**: XCP −93% vs BTC −73% — the altcoin premium unwinding harder than the market. *(data)*
- **Meanwhile, outside**: **the Rare AF live auction in NYC (Jan 13) — HOMERPEPE selling for
  ~$38k in PEPECASH — happened three days after XCP's all-time high.** Mania's last party, on our
  own data's peak week. Grounded in the chat archive: that very day someone posts "unless he is
  going to the rareaf meetup in NY," and BITCORN's chat notes a post-RareAF trading bump that
  spring. ERC-721 was only finalized that January — the standard arrived after the scene it
  described. *(chat-grounded + context — verify HOMERPEPE figure)*
- PEPECASH's ATH is also here: ~**$0.099 in January 2018** — a dime, up ~1,650× from its
  $0.00006 birth — then −97% by December. *(data)*
- Angle: **the hangover and the pivot**. What a scene does when the tourists leave.

## 2019 — The Vending Machine

- **Dispensers activate Jul 15** (with sweeps + P2SH encoding) — the protocol's biggest invention
  since the DEX: on-chain vending machines that sell for BTC. First 23 dispenses = $648. Within
  three years this venue out-fills the DEX 2.5:1.
- Segwit support lands Jan 6.
- Quietest DEX year of the classic era: 5,612 fills / $197k raw.
- **BITCRYSTALS becomes the card money** (sale of the year: SATOSHICARD for $4,426 in BITCRYSTALS)
  — with XCP illiquid, the game token became the unit of account. Echo of PEPECASH-as-money.
- Only 1,112 new assets from 185 issuers — but 11,117 newcomers still arrived (mostly holders
  receiving, worth a look at what they did).
- **vs BTC**: XCP −35% while BTC nearly doubled (+87%) — the recovery skipped Counterparty. *(data)*
- **Meanwhile, outside**: "crypto is dead" was the year's consensus; DeFi was germinating on
  Ethereum (Uniswap barely months old). **Counterparty shipped on-chain NFT vending machines into
  a world that wouldn't coin "NFT summer" for two more years.** *(context)*
- **Rare AF 2 happened this year** — the chat plans it through spring ("rareaf.2 is on a full
  moon"; "Rare AF 2 flyer is likely gonna be tokenized on XCP"), with promo packs circulating by
  February. The scene threw its second festival in the depth of the winter. *(chat-grounded)*
- The paper trail of a community governing itself through the dark: **CIP21 (dispensers) was
  debated on the forums in May, activated in July**; the Counterparty Foundation ran a full
  nomination-and-election cycle (the top forum threads of the year — and it's the same election
  our broadcast graffiti captured: "Official Nomination: Ryan Peters"); an "Exchange outreach"
  thread fought the delisting tide. GitHub recorded just 6 issues all year. Governance was louder
  than code, and the code that did ship was dispensers. *(primary source)*
- Angle: **infrastructure in the dark**. Nobody watching; the most important feature ships anyway.

## 2020 — The Ghost Town

- **3,705 actors all year — the all-time low.** 2,556 newcomers. 493 new assets. The chain nearly
  went silent.
- And yet: dispensers reached parity with the DEX ($73k vs $79k clean) — the vending machines kept
  the lights on. MPMA sends activate Feb 9 (batch sends — infrastructure again).
- **The first Emblem Vault fill: $18.** The bridge that would carry $90M the next year enters as a
  rounding error. Great closing beat.
- Bitcorn farming (28 cards) was arguably the most alive community.
- **vs BTC**: the cruelest split in the ledger — XCP −24% while BTC did **+304%** and closed the
  year at its exact yearly high ($28,990 on Dec 31). Crypto's biggest adoption year (COVID crash
  in March — our BTC low $4,857 — then DeFi summer, PayPal) was Counterparty's emptiest room.
  *(data + context)*
- Angle: **the year everyone left — and what stayed**. Shortest page; make emptiness the design.

## 2021 — The Rediscovery

- **$163.6M clean volume — the all-time record** — and it's not the DEX: Emblem $90.5M + dispensers
  $43.7M + DEX $26.4M + Scarce City auctions $3.0M. The NFT world found the OG chain through a
  wrapper, and the market structure inverted in one year.
- **PEPEMILLION: $896,411** — the biggest card sale in Counterparty history (Nov 20, in BTC).
  RAREPEPE (the nakamoto card): $8.06M across just 65 fills.
- XCP itself: $1.12 → $27.38 high — a 24× intra-year echo of 2017.
- Punk Frens (1,000), Dank Directory begins (471), **Fake Rares born (Sept)** — the parody wave starts.
- Only 10,939 newcomers — the money 10×'d but the people didn't: old holders got rich, few arrived.
  Sharpest single insight of the year.
- **The great awakening of the sleepers**: UMBRELLA (born Nov 5 2014) traded for the first time on
  **Nov 5 2021 — seven years to the day**. TEDDY, CUPCAKE, CALENDAR, DINOSAUR (all March 2015) woke
  within one week of each other that November. FEELSGOODMAN slept 5.2 years, then did $792,881
  lifetime. Dormant names became antiques; the 2015 flood finally cleared.
- Emblem's $90.5M passes the sniff test on breadth: the top-10 is only ~18% of it (PEPEBASQUIAT
  $2.55M/51 fills, PEPALISA $2.19M, FDCARD $1.99M with a $412k single, RAREPEPE $1.32M on 4 fills,
  biggest $494k). Broad market, not one wash pair — still label it "wrapper-market era" on the page.
- No notable protocol activations — the only culture-only year in the ledger.
- **vs BTC**: XCP +799% vs BTC +57% — the biggest relative win since 2014. *(data)*
- **Meanwhile, outside**: Beeple's $69M Christie's sale (March) started the year; BTC topped
  $67,555 (Nov, our data); DOGE and SHIB made memecoins a market. And the outside world **coined
  the name for what it found here**: the chat's first "historic NFT" appears Nov 5, 2021 — the
  same week the sleeper assets woke. The category "Historical NFTs / HNFTs" is this year's
  linguistic invention. *(chat-grounded + context)*
- The newcomers also brought their dialect: "gm," "ser," and "fren" enter the chat for the first
  time in 2021 — before this year, nobody in nine years of logs said "gm." *(chat-grounded)*
- Angle: **rediscovery without return**. The world visited; it didn't move in.

## 2022 — The Parody Renaissance

- **Dispense fills all-time record: 50,966** — the vending machine is now the people's venue
  (dispensers: $17.0M, Emblem $24.2M, DEX $5.4M).
- The counterfeit-as-art wave peaks: **Dank Directory 1,581 + Fake Commons 1,331 + Kaleidoscope
  1,119 cards**. 29,884 new assets — most since 2015, and this time they're used.
- Oracle dispensers (CIP03) activate Sep 10 — USD-priced vending via signed price feeds.
- **Destruction became devotion — the all-time burn year: 5,179 destructions**, led by PEPECASH
  (1,060 burns — the Fake Rare submission ritual demands it), then FAKEASF, DANKMEMECASH,
  FAKEAPECASH. The parody economies ran on proof-of-burn; 12,225 XCP also died in issuance fees
  (2nd all-time). Dividends peaked too (1,188 payouts). The chain's most ritualistic year.
- PEPEALASSAD: $682k (Jan 30). XCP fades $10.65 → $2.58.
- **vs BTC**: XCP −76%, BTC −65% — everything fell; the parody scene partied anyway. *(data)*
- **Meanwhile, outside**: Terra collapsed in May, FTX in November, NFT volumes fell ~90% — and in
  the middle of it the scene held **HNFT Fest in Barcelona (Sept 27)**, complete with a "rare pepe
  scientist dinner" (the community's own name for itself, verbatim from the invite). The chat's
  "historical NFT echo chamber is growing bigger" (Jan 2022) while the rest of the market burned.
  "Grail" also enters the lexicon this year. *(chat-grounded + context)*
- Angle: **the copy is the culture**. Fakes of fakes, and bigger than the originals ever were.

## 2023 — The Second Immigration

- **All-time records: 409,346 txs, 63,818 actors, 59,041 newcomers, 83,093 new assets from 9,868
  issuers.** Bigger than 2017 on every people metric — this is Stamps/SRC-20 arriving on
  Counterparty rails. STAMPUNKS alone: 9,999.
- The immigrants weren't traders: DEX fell to $1.3M while Emblem did $22.0M. Two economies sharing
  one chain.
- **WINKELPEPE, verified and better than it looked: someone put 20.75 BTC ($632,728) into a
  dispenser** for one card on Apr 14 — a vending-machine purchase, on-chain BTC, no marketplace.
  Possibly the largest dispense ever; frame it as "the most expensive vending machine transaction
  in history."
- **70,399 broadcasts — 10× the old record (2014's 7,208)** — the stamps era runs on the broadcast
  layer. The sportsbook wire of 2014 became the minting rail of 2023: same message type, different
  civilization.
- Multiple-dispenses batch activates Dec 1.
- **vs BTC**: XCP +65% vs BTC +155% — up, but the recovery belonged to Bitcoin. *(data)*
- **Meanwhile, outside**: **Ordinals launched in January and lit Bitcoin's data layer on fire;
  Stamps chose Counterparty as its rail in March.** The chat tells it in real time: "ordinals"
  mentions go 0 → 211 in one year, "stamp" goes 7 → 421 (then 965 in 2024). The second immigration
  has an exact external cause. *(chat-grounded + context)*
- Angle: **the chain got colonized** — by people who'd never heard of Rare Pepes. Contrast 2017's
  immigration (traders) with 2023's (stampers).

## 2024 — The Protocol Rebuild

- **Oct 17: the biggest activation day since 2014** — fairminters, UTXO support, free subassets,
  and more, all at block 866,000. The Counterparty Core rewrite era pays off on-chain.
- And it worked immediately: **204,621 fairmints in the feature's first ~10 weeks.** MINTS closed at
  exactly 100,000 mints from 1,376 wallets; PEPEFAIR drew **1,402 distinct minters** — plausibly the
  most-participated mint event in chain history. (Fairmints then fell 96% in 2025 — the launch was
  the peak.)
- The developer record confirms the rebuild at full scale: **40 releases and 934 GitHub issues in
  2024 — more releases than the previous ten years combined** (29 across 2014–2023; 2018 had
  exactly one). Loudest chat year, loudest tracker year, biggest activation day: one story from
  three archives. *(primary source)*
- XCP doubles against the tide: $4.11 → $7.28 (high $12.51) — the only up-year for XCP since 2021.
- 34,751 new assets (stamp echo), 16,634 newcomers.
- Market re-concentrates in grails: RAREPEPE $176k sale; PEPECASH back in the top 3 traded.
- **vs BTC**: XCP +77% vs BTC +111% (ETFs approved January; $100k crossed in December, high
  $106k). PEPECASH beat them both: +108%. *(data)*
- **Meanwhile, outside**: the halving in April launched **Runes — a direct fungible-token
  competitor on Bitcoin — and Counterparty shipped fairminters six months later anyway.** The chat
  called the matchup: "While people are aping into Runes circa 2024 we could see HNFT cycle ran
  back for things like PEPECASH and BITCORN and XCP itself." Runes chatter spiked to 153 mentions
  and collapsed to 1 the next year. Also the loudest chat year ever recorded: 26,321 messages.
  *(chat-grounded + context)*
- Angle: **the rebuild**. Protocol chapter leads for once; the mint mechanics changed forever.

## 2025 — The Long Tail

- Taproot support + fairminter v2 activate Jun 20; P2SH encoding retired — the modern tx format era.
- **Emblem churn: 71,622 fills but only $4.9M** — record fill counts at record-low ticket sizes
  (~$69 average). Compare 2021: $5,968 average. The market widened and shrank at once.
- XCP $7.12 → $1.93. The 2,599-subasset wave resolves to **two drops: LOONEY.* (1,000) and
  XCPFOLIO.* (999)** — 77% of the year's subassets from two projects. Free subassets (Oct 2024)
  made thousand-piece drops economical; this is that feature's first full year.
- LFG Collection (113) leads new cards; SATOSHICARD takes sale-of-year again ($54k).
- **vs BTC**: XCP −73% in a year BTC merely drifted (−7%, after a $124,720 high). The bleed was
  ours, not the market's. *(data)*
- **Meanwhile**: the scene turned historiographical — davesta's HNFT milestone graphics, pioneer
  interviews (Tatiana Moroz, Rare Scrilla, Adam B. Levine), Emblem Vault research calls. The
  community started writing its own history down. This site is part of that current.
  *(chat-grounded)*
- Angle: **many hands, small bags**. Honest, melancholy, still alive.

## 2026 (partial) — The AMM Era

- **Jun 8: AMM pools + indefinite orders + ordinals metadata activate** — the DEX's first structural
  upgrade in a decade. Fairmint pools follow (block 961,100, ~Aug). The year page should track
  whether AMM revives on-chain markets.
- First ETH-settled sale-of-year (DARKPILLPEPE $23k via Emblem) — the money arc reaches ETH.
- **Zaif is still quoting XCP in yen — 105 trading days so far this year.** Ten straight years of
  attributable Japanese prints (2016–2026). Not a delisting arc after all: the last exchange
  standing never left.
- Rare Pigeons (181), Faux Bitcorn (84), RarePenPen (77) — parody continues.
- 9,423 new assets from only 207 issuers (~46/issuer — automated minting; check who).
- **vs BTC**: tracking together for once — XCP −26%, BTC −27% YTD (BTC $88.7k → $64.6k; a bear
  year outside too). *(data)*
- Angle: **year in progress**. Ship the page with live "as of" framing; it fills in as the year runs.

---

## Zoom-out — the arcs (what makes 13 pages one story)

1. **Price**: $0.54 burn-price → $9.41 first spike → $0.48 despair (2016) → $36 mania (2017) →
   **$88.93 ATH (Jan 2018)** → long fade → $27 echo (2021) → $12.5 echo (2024) → ~$1.5 now. A
   year-band (open/close/hi/lo) strip should recur on every page, current year lit — it's also the
   year-nav.
2. **Market structure**: DEX-only (2014–18) → +dispensers (2019) → +Emblem/Scarce City (2021) →
   dispenser peak (2022) → Emblem-dominant (2023–) → AMM (2026?). Same stacked venue chart every
   year = the arc is legible page to page. The CEX shadow inverts the expected story: **Zaif has
   quoted XCP in yen continuously from mid-2016 to today** — listed in the Rare Pepe autumn, biggest
   year in the 2018 crash (1.66M XCP), still printing in 2026. "Japan never left" is a recurring
   strip across all pages, not a 2017 one-off.
3. **Money** (what trades settle in): BTC (2014, working) → XCP (reserve) → PEPECASH (2017, the meme
   as money) → BITCRYSTALS (winter unit of account) → BTC again (2021+, via wrappers) → ETH (2026).
   The sale-of-the-year's currency is the one-line version.
4. **Culture**: bets/bitbowl → game cards (SoG, FoW, FDCARD) → pepes → farming games (Bitcorn) →
   parody (Fake/Dank) → stamps → pigeons. SATOSHICARD as the recurring grail. Rare Pepe's
   birth-peak-close spans exactly 2016→2018.
5. **People**: two immigrations (2017 traders ×34k, 2023 stampers ×59k), one near-death (2020, 2.6k),
   and 2021's paradox — record money, no new people.
6. **Protocol**: toybox (RPS/bets) → asset platform (numeric/subassets) → retail rails (dispensers/
   oracles) → mint rails (fairminters/UTXO/taproot) → markets (AMM). Every year except 2021 has a
   real activation — protocol_changes.json (canonical, by block height) is the source; dates mapped
   via our blocks table.
7. **Dormancy & revival** (new — from the asset-age thread): names sleep and wake. The 2015 flood's
   1.1% usage → the Nov 2021 awakening (UMBRELLA's 7-years-to-the-day first trade; FEELSGOODMAN's
   $792k second life; FLOCK's 8.9-year sleep ending in 2023). A "sleeper of the year" feature works
   on nearly every page from 2021 on, and quantifies why registration year ≠ vintage.
8. **Burning** (new): the chain's relationship with destruction changes meaning each era — burning
   as **founding** (2,125.6 BTC, 2014) → burning as **rent** (issuance fees; 2015's spam flood
   destroyed a record 17,756 XCP) → burning as **devotion** (2022's 5,179 destructions; PEPECASH
   burned as Fake Rare ritual). One arc, three theologies.
9. **The broadcast layer's two lives**: sportsbook wire (7,208 in 2014, oracle feeds for bets) →
   near-silence for eight years → minting rail (70,399 in 2023, stamps). Same message type,
   different civilization; good recurring "chain chatter" stat.
10. **Graffiti of the year** (new — confirmed feature; the chain in its own voice, verbatim):
   - 2014: "Will the price of gold rise by 12:00 AM UTC, Sep24? 1=yes, 2=no" *(a live bet feed)*
   - 2015: "The block chain is the prison of truth. | Michel Foucault"
   - 2016: "This is a test of the emergency broadcast system."
   - 2017: "Price goes up, Price goes down, Counterparty just keeps on working :)"
   - 2018: "Kaleidoscope ASCII Asset Enhancement - Phase 1: Compression - completed"
   - 2019: "Official Nomination: Ryan Peters for Counterparty Foundation." *(an on-chain election)*
   - 2020: "How do i transfer Dollarcash crypto into my bank account?" *(the ghost town, verbatim)*
   - 2021: "This is a test transmission. You're a sexy …"
   - 2022: "HAPPY BIRTHDAY SATOSHI, you changed the way we view the world." *(also: Loretta Lynn
     lyrics broadcast weeks after her death — the chain as memorial wall)*
   - 2023: "Send me the 300 XCP you stole, motherfucker - 1Srqx…" *(grievance, notarized)*
   - 2024: "I am J-Dog, developer of XChain and FreeWallet, and I support a fee on numeric a…"
     *(governance by broadcast)*
   - 2025: "Not your average art directory — thecounterp.art"
   - 2026: "an AI issued its first token today. block 936030." · "every satoshi a syllable, every
     block a breath" *(and a bet-formatted feed about a RAREPEPE OpenSea sale — the sportsbook
     wire stirring again in the AMM era)*

11. **The majors scoreboard** (open→close each year; XCP/BTC from the daily price calendar,
   PEPECASH from first/last-month trade VWAP — thin months are noisy, 2019 PEPECASH excluded as
   illiquid): XCP beat BTC in only four seasons — 2014, 2016, 2017, 2021 — but the wins were
   monsters. A recurring "scoreboard" strip per page: XCP · BTC · PEPECASH, one row, win bolded.

   | Year | XCP | BTC | PEPECASH |
   |---|---|---|---|
   | 2014 | **+646%** | −59% | — |
   | 2015 | −85% | +37% | — |
   | 2016 | **+182%** | +123% | +217% (from Sept birth) |
   | 2017 | **+1,611%** | +1,296% | **+19,000%** (~200×) |
   | 2018 | −93% | −73% | −97% (ATH ~$0.099 in Jan) |
   | 2019 | −35% | +87% | (illiquid) |
   | 2020 | −24% | **+304%** | −58% |
   | 2021 | **+799%** | +57% | −30% (spiked into Jan) |
   | 2022 | −76% | −65% | −61% |
   | 2023 | +65% | **+155%** | +46% |
   | 2024 | +77% | +111% | **+108%**\* |
   | 2025 | −73% | −7% | −76% |
   | 2026* | −26% | −27% | −15% |

   \*2024: PEPECASH beat BTC on the year — a fun page-level fact for 2024.

**Records ledger** (each page may claim only its own):
- Txs / actors / newcomers / new assets / broadcasts: **2023**. Raw DEX fills: **2017**.
- Clean USD: **2021**. Dispense fills: **2022**. Destructions: **2022**. Fairmints: **2024**.
- XCP ATH: **2018**. Zaif's biggest year: **2018**. Biggest sale: **2021** (PEPEMILLION $896k).
- Biggest dispense: **2023** (WINKELPEPE, 20.75 BTC). XCP destroyed in fees: **2015** (17,756).
- Cheapest XCP ever: **2016** ($0.48). Quietest year: **2020**. Bets: **2014** (1,105; dead after).

**Coherence rules**:
- Fixed chapter vocabulary, variable emphasis: Price · Venues · Money · Mint · Cards · Moments ·
  Protocol. Thin years (2019/2020) lead with Protocol/Venues and shrink Market; 2021 leads Market
  and drops Protocol. Never force a leaderboard where there were no trades.
- One measures appendix shared by all pages (the glossary above) — every number traceable to a
  query; raw vs clean always labeled.
- Retroactive-collection caveat everywhere "born in year" appears.

**Resolved on the second pass** (details woven into the year sections above):
- ~~Zaif end date~~ → **never ended**: continuous yen prints 2016→2026; biggest year 2018.
- ~~2025 subasset wave~~ → two drops (LOONEY 1,000 + XCPFOLIO 999).
- ~~Emblem 2021 quality~~ → broad, top-10 only ~18% of volume; label "wrapper-market era", don't
  disclaim it away.
- ~~2015 usage~~ → 394 of 36,552 ever traded (1.1%); flood burned a record 17,756 XCP in fees.
- ~~WINKELPEPE~~ → verified: a 20.75 BTC dispense. Stronger than the raw number.
- ~~BTC settlement death~~ → died in **2015** (1,830 btcpays → 11); minor wrapper-era revival
  2020–22 (155–275/yr); effectively zero again since 2025.

**Also resolved on the third sweep**:
- 2026 minting → **machines**: four wallets registered 4,938 of the year's 9,423 assets (2,000 +
  1,000 + 1,000 + 938). The mint chapter for 2026 is about automation, not creators.
- 2022 dividends → **the Five Families**: BONANNO, COLOMBO, GAMBINO, GENOVESE each paid 12 monthly
  tributes in MAFIACASH (Mafia Wars economy), plus PEPEWETRUST paying DESANTISCASH. Game economies,
  not finance.
- Broadcast graffiti → confirmed feature; per-year quotes in arc 10 above.
- POKEMON art → survives on the CDN (image/png, HTTP 200). The first card sale can show its card.

---

## The chat archive — zeitgeist grounding

Primary sources on disk (`C:\Users\laptop\Downloads\Telegram Desktop`, latest export per chat):
**Official Counterparty Chat** (123k msgs, Jul 2017 → now), **BITCORN** (123k, 2018 → now),
**Dank Auction House** (153k, 2022 →), **ROCCOS OUTBACK AUCTIONS** (51k, 2022 →), RARE PEPE
PROJECT, RarePenPen, XCP Wallet, Lounge. Nothing pre-Jul-2017 — the 2014–16 zeitgeist needs other
sources (bitcointalk, the broadcast layer itself).

**Chat volume is a zeitgeist signal of its own**: Official chat's loudest year is **2024**
(26,321 texts — the rebuild, not the mania); BITCORN's first year (2018: 38k msgs) out-talked any
Counterparty chat year ever; Dank Auction House peaked 2023 (77k) — the auction floor at full
roar; everything cools sharply in 2025.

**Lexicon timeline** (first appearance / peak, Official chat): the native dialect was
kek · based · hodl · moon (2017–18). **"gm", "ser", "fren" all first appear in 2021** — the
NFT-Twitter dialect arriving with the tourists — and peak 2022. "wagmi" never took root (3 uses
in nine years; the community kept its own voice). "dispenser" enters with the 2019 activation and
peaks with the 2022 fills record (1,564 mentions). "grail" is coined into use in 2022.
"stamp": 7 → 421 (2023) → 965 (2024). "ordinals" and "runes" spike and die within ~18 months
each. "fairmint" appears exactly in 2024. Word-arrival = era boundary; a per-year "the year in
words" strip is cheap and delightful.

**Events timeline (chat-grounded)**:
- **Rare AF / Rare Digital Art Festival, NYC, Jan 13 2018** — same week as XCP's ATH; rareaf.com
  shilled in-chat from Sept 2017; BITCORN notes a post-event trading bump.
- **Rare AF 2, 2019** — planned in-chat through spring ("rareaf.2 is on a full moon"), flyer
  tokenized on XCP, promo packs by February.
- **HNFT Fest, Barcelona, Sept 27 2022** — with a "rare pepe scientist dinner"; another Barcelona
  gathering flagged for May 2024. A 2023 "we discussed this at RareAF" mention suggests a third
  RareAF-branded gathering — worth confirming with attendees.
- **The HNFT arc**: term first appears Nov 5 2021 ("labeling it 2014 historic NFT" — the same week
  the sleepers woke) → "echo chamber growing" (Jan 2022) → its own explorer hnft.wtf (2023) →
  "HNFT cycle" thesis vs Runes (2024) → historiography era (davesta's pioneer interviews, 2025).
  Counterparty's category name was coined by the people rediscovering it.

**Lexicon for page copy** (use their words, not ours): rare pepe scientists · grails · frens ·
dank · fakes/fakes-of-fakes · HNFTs / historic NFTs · "Rare AF" · submissions · series/cards ·
dispensers as "vending machines." The 2017 page's "Price goes up, Price goes down, Counterparty
just keeps on working :)" (an actual 2017 broadcast) is the house voice.

---

## The developer record — releases, issues, forums, bitcointalk

Four more primary sources, now mined:

- **bitcointalk topic 395761** — the founding document. "[ANN][XCP] Counterparty — Pioneering
  Peer-to-Peer Finance", posted Jan 2, 2014 3:51 PM, **the same day as the first recorded burn**.
  The OP promises to "democratize finance"; not one word about art. Every year page can measure
  itself against that sentence.
- **counterparty-core releases by year** (86 total): 2014:3 · 2015:8 · 2016:4 · 2017:3 · 2018:1 ·
  2019:2 · 2020:1 · 2021:4 · 2022:4 · 2023:3 · **2024:40** · 2025:10 · 2026:3. The version arc
  runs counterpartyd v9.49 (2014) → counterparty-lib v9.50 (2015) → v11.2.0 (Jul 2026).
- **GitHub issues created by year**: 2014:344 → 2019:**6** → 2024:**934**. Dev energy has two
  mountains (founding, rebuild) and a nine-year valley — the same U-shape as everything else,
  except culture, which peaked *in* the valley.
- **Forums all-time top threads map the eras** (250 pulled, chronological): Counterwallet support
  (2014, 396 posts) → Foundation elections (2015/2016/2017/2019) → EVM gas debates (2016) →
  Serialized Tokens (2017) → CIP21 dispensers + Exchange outreach (2019) → Foundation public forum
  (Feb 2020) → XTROPTIONS.GOLD conversion (2020) → then near-silence: two top-tier threads total
  in 2022–23. **The forum itself has an arc**: conversation migrated bitcointalk → forums →
  Telegram (our chat archive picks up exactly where forum volume fades, 2017 on). Where the
  community talks is itself era data.
- **The idea-lag pattern** (forums → protocol): subassets proposed Dec 2015 → activated May 2017.
  "Decentralized Asset Sales" proposed Dec 2017 → dispensers activated Jul 2019. MPMA CIP Apr
  2017 → activated Feb 2020. Counterparty's features spend 18 months to 3 years as forum threads
  first — a recurring "this year's idea, that year's protocol" connective for the pages.

**Still open**: nothing blocking. Next step when building pages: freeze each year's numbers behind
a `/v2/years/<year>` aggregate query so every page cites identical SQL. Chat-derived facts are
quotable but cite them as "from the community archive" and verify names/dates before publishing
externally.
