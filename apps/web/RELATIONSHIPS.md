# xcp.io — Relationship & Insight Surfaces (research)

What's *unique and valuable* to surface from the Counterparty dataset, grouped by where it lives.
Counterparty is NFT/collectible-heavy and event-sourced, so the gold is in **relationships between
addresses and assets** (sends, trades, dispenses, sweeps, dividends, issuances) — a real social/
economic graph, not just balances. Precompute later; this is about *what* to show.

Dataset scale (2026-06): sends 1.77M · dispenses 207k · order_matches 216k · dispensers 102k ·
dividends 4.3k · sweeps 1.4k. Send graph = **992k edges, 184k senders, 360k receivers.**

---

## 1. Address page — "who is this, and who do they deal with"

### A. Connections graph (the social/money graph)  ★ build-worthy
Merge every relationship type an address participates in into one ranked "top counterparties" list:
- **sends** in+out (source/destination) — funding & payment relationships
- **order_matches** (tx0_address↔tx1_address) — trading partners
- **dispenses** (operator↔buyer) — commerce relationships
Rank by interaction count/volume. Reveals: exchanges (one dominant counterparty + burn addr),
projects (many one-way recipients = airdrops), trading cliques. *Validated: 14ms indexed.*

### B. Identity lineage via sweeps  ★ unique / web-of-trust
A SWEEP moves *all* assets+ownership to another address — the strongest "same person" signal on
chain. Show "Swept → B (block N)" / "Swept from ← A" and chain them into an **identity cluster**.
Live pattern: recent sweeps migrate legacy `1…` → native segwit `bc1q…` (wallet upgrades). This is
the closest thing to a verifiable "this OG address is now this one."

### C. Behavioral archetype + trust profile
Synthesize signals into a profile chip set: account age (first/last block), issuer status (and how
many of their issuances are **locked** = can't rug), dividends paid (rewards holders = good actor),
dispenser track record (sales count, reliability), whale status, counterparty diversity (1 partner
= service/bot; many = real user). Non-owners viewing an address want exactly this.

---

## 2. Asset page — "what is this, who holds it, how did it spread"

### A. Collector cohort — "holders of X also collect…"  ★ build-worthy / very unique
Holders-also-hold graph. *Validated:* RAREPEPE holders also hold CLUBCCC, DANKSTERPEPE, ELONPEPE,
PEPECASH — the actual Rare Pepe collector community. Display as a **row of asset art thumbnails**
(gorgeous, instantly useful, recommendation-engine feel). No other CP explorer does this well.

### B. Distribution & concentration health
- Holder count + **top-10 % of supply** (PEPECASH: 7,831 holders, top-10 = 62%). Decentralization
  / rug-risk gauge (bar or gini).
- Distribution method breakdown: fairmint vs dispenser vs DEX vs direct-send/airdrop — *how* it spread.
- Holder count over time (growth curve).
- **OG holders**: addresses holding continuously since first issuance.

### C. Dispenser price history (a chart even for non-DEX assets)  ★
Dispensers carry `satoshirate` over time → a real price-discovery timeline. PEPECASH was vended via
2,028 dispensers from 0.00000001 → 44 BTC. Plot satoshirate vs block_time + dispense volume bars.

### D. Issuer reputation inline
Issuer's other assets (family), locked ratio, dividends paid. `bc1q24kj…` = 15,598 assets nearly all
locked (factory); `1CXj1bLM…` = 7,784 unlocked (very different trust). Surface the contrast.

---

## 3. Global / explore — "interesting slices"

- **Most-traded** (DEX liquidity): PEPECASH 52.9k matches, BITCRYSTALS 12k, VACUS, RAIZER…
- **Biggest vending businesses**: single dispensers with 16,993 / 12,289 sales.
- **Issuer leaderboard** by assets + locked ratio (creators).
- **Dividend payers** (projects rewarding holders): 1Mafiam… pays across BONANNO/COLOMBO; EARNFREEBTC 84×.
- **Asset families / collections** via co-holding clusters (community detection on the holder graph).
- **Velocity**: most-transferred assets (active vs dormant).
- **Whale moves / large sends** feed.

---

## Display principles
- Lead with **art** (asset thumbnails) wherever assets are listed — it's a collectibles chain.
- Relationships as **ranked lists with mini-bars** first; graph viz only where it earns its keep.
- Trust/identity signals as **chips** (locked, dividends-paid, swept-from, OG) — scannable at a glance.
- Every metric links to the records that prove it (concentration → holder list, cohort → that asset).

## Top build candidates (visual + unique, queries validated)
1. Asset "Holders also collect" art row + concentration stat.
2. Address "Connections" panel + sweep identity lineage.
3. Asset dispenser price-history chart.
