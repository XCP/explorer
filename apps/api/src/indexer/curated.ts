/**
 * Human-maintained allow/deny lists used by the signal passes. Kept separate from the cron mechanics
 * so the lists that actually get hand-edited (burns, exchanges, low-quality) live in one obvious place.
 * Each list also exports a `…_SQL` string ('a','b',…) ready to drop into an `IN (…)` clause.
 */
const sqlList = (xs: string[]) => xs.map((a) => `'${a}'`).join(",");

// Curated low-quality list (imported from xcpdex's manually-maintained `hidden` set + explicit calls).
// Catches sophisticated coordinated wash / scams that intrinsic signals can't (e.g. wash spread across
// 600+ sock-puppet addresses, or dust-airdrop scams). Extend by adding assets here. Bridge/exchange
// tokens (OXBT/ORDIPEPE/OGPASS) included — a raw BTC-volume threshold caused false positives, so these
// are curated explicitly rather than auto-flagged by dispense volume.
export const CURATED_LOWQ = [
  "A11984891106868617664", "A13401453567681343017", "A14074648224959053374", "A16633791645021321509",
  "A2384426809477115589", "A2848268701430318990", "A4391853287542981791", "A5557021997076742535",
  "A6545283291136814819", "A7771332604329827915", "A8857415869833437486", "CRYPTONAIRA", "DIAMONDBOND",
  "DIKKE", "ERDE", "GPSHARES", "GUANII", "HANJ", "HOMMALICOIN", "KVELL", "LUUSH", "MACROSS", "METISS",
  "MUUI", "NARUCHAN", "NVST", "OGPASS", "ORDIPEPE", "OXBT", "PANDAGOLD", "PERFECTCERTS", "PIENA",
  "PROTEIOS", "RCANA", "RESORTLIFE", "RIAM", "TETLAS", "TROPTIONS", "VACUS", "WOOOOK", "COUNTEREVENT",
  "RAIZER", "FUHCOIN", "TAOCOIN", "NAGEZENI",
  // TROPTIONS family (scam cluster — incl. subassets by numeric id): XTROPTIONS, TROPTIONSPAY,
  // TROPTIONSBC, TROPTIONS.SHARES, TROPTIONS.THORIUM, XTROPTIONS.TH
  "XTROPTIONS", "TROPTIONSPAY", "TROPTIONSBC", "A13836077288900301480", "A4219293356469046725", "A921933274660182119",
];
export const CURATED_LOWQ_SQL = sqlList(CURATED_LOWQ);

// Curated exchange / consolidation-hub addresses. Hard-coded (not heuristic) because the heuristic
// (XCP custody) false-positived whales, and token treasuries (SJCX/FLDC/LTBC) look exchange-like.
// Seeded from the high-inbound + deposit-fed set, reviewed. Add/remove here. Deposit detection keys off this.
export const EXCHANGES = [
  "1AeqgtHedfA2yVXH6GiKLS2JGkfWfgyTC6",  // Bittrex (chat-confirmed)
  "1XCPdWb6kk7PGfvbdRbRuNh51aPc4vqC7",   // Poloniex (chat-confirmed)
  "1Po1oXMCWobE6kxWr8rJEP1SRq71JSD3t4",  // Poloniex (vanity 'Po1oX'; community-confirmed)
  "1BCYpzZAmH3pX7EXU6s4gxtG1AoVMn2NfJ",  // Poloniex (BCY vanity; community-confirmed)
  "1PNkBxnz5ePW8FeK6CSs8V2fGHcN9B6HNk",  // Zaif - community-confirmed
  "1NFeBp9s5aQ1iZ26uWyiK2AYUXHxs7bFmB",  // BTER (old) - community-confirmed (peak ~170k XCP)
  "1GEMZsZZQ32YqX3nzBptQLJBAtn1XByRCZ",  // Poloniex (GEMZ vanity; community-confirmed)
  "19fNvdGbD3dP5zqAsQhDqGyENnR5bHvZB1",  // DEX-Trade hot wallet (chat-confirmed)
  "1LhEGAPUZnfNDbh7oFogdekUyTW8NBfW3g",  // DEX-Trade wallet #2 (chat-confirmed)
  "1SJCXrYsuWmZzmAhA9K4fYkKqgGyLim79",   // Poloniex (SJCX vanity; community-confirmed)
  "1FLDCfr9iG7n6bAdGsqBXmhaLgC4aSze72",  // Poloniex (FLDC vanity; community-confirmed)
  "1LTBCyh9dKhNNZFaByPXfrkeuAD7yr6A4b",  // Poloniex (LTBC vanity; community-confirmed)
  "1AhAExgxS6aVRdKdyEuC5M4v6dxdzdgTaq",  // Zaif (chat-confirmed; vanity 'Exg')
  "15ctNNSfo84dW5Ki8fTkcqbFAyfGbBXwsC",  // Poloniex cold storage (chat-confirmed)
  "1N9XWkNp4zPykh8kajbwJXY5d5ZzkQXs3L",  // Huobi deposit (chat-confirmed)
  "1F2zjMv6dTwTW4r9fJ7zTonXp7Tfk23su3",  // Zaif #1 - community-confirmed (131k XCP; was suspected whale-FP)
  "3DZzgGNxsSK1XyUJcKHLM9PxLTEypPGo8W",  // Zaif #2 - community-confirmed
  "1ML2b9tY5V8S9qQw6jNUs5uxkm6nKayk6x",  // Zaif cold - community-confirmed (emptied -> 1F2zjM)
  "1E1QuzwVeLdnQdNq38gBsyH8ht39UdHPAh",  // Zaif - community-confirmed
  "1AqUTSTGB6coR5AYcwFFM6nXoULapXqtdL",  // TUX - community-confirmed
  "1CcWRPF4Eksnn49Rx2dZ3dgJW9kiX8VGE2",  // TUX - WalletExplorer cluster match to 1AqUTST (round-trip 17.7%)
  "12PrRwgmAgsVJy8G7uQryi78ugGurt7vaM",  // BTER - community-confirmed
  // Zaif / Tech Bureau official issuing wallets — issued ZAIF, MIJINCOIN, BITGIRLS/BITBOYS, KATARIBE,
  // JPYZ, etc. (an exchange that ran its own token projects — so issuance here is NOT a creator signal).
  "1PH4KzJ7VpwPZR3VnP8anmcMTjJEGt73Gz",  // Zaif/Tech Bureau issuer - community-confirmed
  "14rR75DYPaKLSt6UHBakR2h3n8QadTEGxG",  // Zaif/Tech Bureau issuer - community-confirmed
];
export const EXCHANGES_SQL = sqlList(EXCHANGES);

// Burn addresses — FULLY HARD-CODED (no pattern/heuristic). Every one verified: readable burn-intent
// vanity (or named burn) AND never debited. Sourced from the community Telegram "all the burn addresses"
// post plus reviewed readable multi-sender sinks. Burns are excluded from circulating supply, top-holder
// lists, and reputation/connection graphs. Add new burns here explicitly (93 confirmed).
export const CURATED_BURNS = [
  "11ParticipantsXXXXXXXXXXXXXUGmPx6", "123AnditsGone111111111111111Ymiao1", "191mMadYoureMadxxxxxxxxxxxxxvwA4Up",
  "1AMpauLXXXXXXXXXXXXXXXXXXXWzywCd6j", "1AgeofChainsSeries1Burnxxxy1xR3Ao", "1AsseticBbXXXXXXXXXXXXXXXXXXbeMmNH",
  "1AsseticJLJLJLXXXXXXXXXXXXXXU87kKM", "1AsseticKanaddahXXXXXXXXXXXXRntPiE", "1AsseticXXXXXXXXXXXXXXXXXXXXY69xbC",
  "1AsseticooakosiMoXXXXXXXXXXXVWtCYm", "1AsswhoisitXXXXXXXXXXXXXXXXXY2F4pu", "1BURNFoWXXXXXXXXXXXXXXXXXXXY5LRms",
  "1BURNSogXXXXXXXXXXXXXXXXXXXXW3ny2Y", "1BURNTSH1RTxxxxxxxxxxxxxxxxuckhAY", "1BURNXXXXXXXXXXXXXXXXXXXXXXXTVanmh",
  "1BURNmentorsxxxxxxxxxxxxxxxwUtLJh", "1BitSupraBurnProofXXXXXXXXXXUqAPsu", "1BitcoinEaterAddressDontSend8MUo1T",
  "1BitcoinEaterAddressDontSendf59kuE", "1BitcornCropsMuseumAddressy149ZDr", "1BoJxKoKUSAixKAiToRixxxxxxwz1Pa5w",
  "1BurnDaNK476q5h7vtf3BTdqKpKu65SKbe",
  "1BurnFakePepexxxxxxxxxxxxxxzo7tqD", "1BurnPenisiumGrowPenisiumxxwGJvsx", "1BurnPepexxxxxxxxxxxxxxxxxxxAK33R",
  "1BurnRustxxxxxxxxxxxxxxxxxxzhjnHj", "1BurnSockxxxxxxxxxxxxxxxxxxwLPxbM", "1BurnXXXXXXXXXXXXXXXXXXXXXXXXekdRL",
  "1Burned4ReissuanceSwapChainzRe7Xq", "1Burningxcpassetsxxxxxxxxxy3ee2wH", "1BurnxxxxxxxxxxxxxxxxxxxxxxxLsYYK",
  "1ByeschoepepeXXXXXXXXXXXXXXXcpHGww", "1CKGAMEBURNiTALLxxxxxxxxxxxxeLDrH", "1CNTSMKxxxxxxxxxxxxxxxxxxxxtSetKh",
  "1CRiNGEXXXXXXXXXXXXXXXXXXXXXWTvJJP", "1ChancecoinXXXXXXXXXXXXXXXXXZELUFD", "1CornHawksxxxxxxxxxxxxxxxxxym3Kin",
  "1CoinandpeaceburnaddressXXWwTTyPw", "1CounterpartyXXXXXXXXXXXXXXXUWLpVr", "1CryptoLifeDotNetBurnAddrXXXSdVx52",
  "1DARKCLAMXF1NALXBURNXXXXXXXXVcPtLv", "1DARKCLAMxBURNXXXXXXXXXXXXXXVvbpkg", "1DARKCLAMxDooGXXXXXXXXXXXXXXZPbYip",
  "1DJasanyanxxxxxxxxxxxxxxxxy1uERgj", "1FauxSoGsBURNxxxxxxxxxxxxxxzme7me", "1FractaLPepeTESTxxxxxxxxxxxuRn48D",
  "1GEMZBURNXXXXXXXXXXXXXXXXXXXVUKFt4", "1GenesisxxxxxxxxxxxxxxxxxxxuRkNpc", "1JGBcoinKokusaiKaitorixxxxxD2iTTp",
  "1JesseFuckedUpxxxxxxxxxxxxxxvk6ma", "1KevineroBurnxxxxxxxxxxxxxxzbrvmF", "1LTBBURNxxxxxxxxxxxxxxxxxxxxQiaRZ",
  "1MafiaWarsGameBurnAddressxy1WbzYg", "1MouLaBurnXXXXXXXXXXXXXXXXXWcixDo", "1MouLaBurnxxxxxxxxxxxxxxxxxxEXzj4",
  "1NPCReprogrammingxxxxxxxxxxtqVgmX", "1NightStaLksxxxxxxxxxxxxxxxxcZVzv", "1PLiPBuRNxxxxxxxxxxxxxxxxxxzEyg27",
  "1PhockheadsBurnAddressxxxxxtEmomy", "1RaribLePEPEPARTYxxxxxxxxxy1a4EHk", "1Satanxxxxxxxxxxxxxxxxxxxxxw4d9KE",
  "1SatoshiRoundtab1exxxxxxxxxtJidRK", "1SwarmxxxxxxxxxxxxxxxxxxxxxwwCyWx", "1TestxxxxxxxxxxxxxxxxxxxxxxzoXNkw",
  "1Trigburnxxxxxxxxxxxxxxxxxxw5X1QR", "1WatchYourBTCBurnxxxxxxxxxxunS7dA", "1WhatissynereoXXXXXXXXXXXXX4p2rSe",
  "1bitfinexxxxxxxxxxxxxxxxxxxzjVHxU", "1burn11111111111111111111113yQZiQ", "1craigxxxxxxxxxxxxxxxxxxxxxsveXGX",
  "1cryptohivexxxxxxxxxxxxxxxxuZjrB6", "1editxxxxxxxxxxxxxxxxxxxxxxwKh9EC", "1finaxxxxxxxxxxxxxxxxxxxxxxtpcuxf",
  "1haiLLordkekxxxxxxxxxxxxxxxtn8WwC", "1hardforkxxxxxxxxxxxxxxxxxxu9iBLr", "1hyugaxxxxxxxxxxxxxxxxxxxxxtkbLXZ",
  "1infamousGraveyardRiPzzzzzzyQKytV",
  "1kanoxxxxxxxxxxxxxxxxxxxxxxztz7Sb", "1kinoshitaxxxxxxxxxxxxxxxxy27FE4R", "1kojixxxxxxxxxxxxxxxxxxxxxy46RA3r",
  "1mikehearnxxxxxxxxxxxxxxxxxzxJYCq", "1oishixxxxxxxxxxxxxxxxxxxxxxFftCZ", "1r3xxxxxxxxxxxxxxxxxxxxxxxy44N3ru",
  "1scamSCAMscamXXXXXXXXXXXXXXXYCXxk", "1segwitxxxxxxxxxxxxxxxxxxxxxwqcT1", "1shadi1aythug1ifexxxxxxxxxxuCqHNS",
  "1shitcoinxxxxxxxxxxxxxxxxxxwY1LYu", "1stLiquidPepexxxxxxxxxxxxxxumd9b8", "1sugiixxxxxxxxxxxxxxxxxxxxxy8KU3n",
  "1thedaoxxxxxxxxxxxxxxxxxxxy3gNefa", "1tokeneconomyxxxxxxxxxxxxxxshrDv5", "1wadaxxxxxxxxxxxxxxxxxxxxxy1c6a95",
  "1zakiyamaxxxxxxxxxxxxxxxxxxw7ybLT",
  // readable multi-sender sinks (no x-padding) — confirmed burns
  "1BitcornSubmissionFeeAddressgL5Xg", "1MonapartyMMMMMMMMMMMMMMMMMQ3QJNm", "1PenPenWaLksToTheMountainnno8UBXN",
  "1DownTheDrainHahaYouFucksxy1LjwNf", "1111111111111111111114oLvT2", "1SaLvationGodsMarveLousGracaLgYQS",
  "1KekuSemauKKWhyphenSM3WpepezAEe4Y", "1JohnViLLARchiguireitorxxxxwhsz7P", "1GMoneyLovesHisConspiraciesXVpgPNR",
];
export const CURATED_BURNS_SQL = sqlList(CURATED_BURNS);
