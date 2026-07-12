# Product direction — persona & expert panel synthesis (2026-07-10)

Output of a 12-agent survey: 6 personas (newcomer, collector, speculator, creator, merchant,
researcher) surveyed what they'd value at-a-glance vs deep-dive on each surface (asset / address /
collection / home), 5 product-expert lenses (PLG, GTM/positioning, IA/UX, retention, data-product
strategy) read those findings + the real inventory, and one head-of-product pass forced a single
opinionated direction. Companion to `product-inventory.md` (the justify-existence ledger).

The one datum that dominated everything: **all six personas independently filed the same
"have-but-buried" complaint.** That's not six problems — it's one ranking failure. The moat
(judgment: quality tiers, Conviction, reputation, bad-actor flags, cohesion, the Emblem census)
is computed, on the wire, and hidden; the commodity (the tape) is the hero.

## Positioning

> **xcp.io is the trust-and-taste layer for Counterparty art: the one place that scores what's
> actually good and proves who's actually real — so you collect with conviction, then buy on
> xcpdex.**

Kill the "blockchain explorer" self-description as the lead — it's a commodity category shared
with xchain/tokenscan and it forces the tape to the front. (The record floor stays; it's
credibility, not identity.)

## Primary ICP: the Collector

The entire moat is collector-native — Conviction, quality tiers, reputation bands, cohesion/wash
detection, graph-trust provenance, the 94k Emblem cross-chain census all answer one question only
a collector asks: *"is this genuine, is it canon, is the seller real?"* The Collector is also the
keystone: creators need collectors, merchants sell to collectors, speculators are collectors in a
hurry. The others are served as byproducts, deliberately cheap:

- **Newcomer** = a funnel *stage* into Collector → orientation copy, not a product line.
- **Speculator** = render the already-fetched 7d momentum and stop. No terminal. That's xcpdex's job.
- **Creator** = sharpest retention hook ("someone collected your card") but smaller and heavier; later.
- **Merchant** = its wishlist (shop dashboards, undercut alerts) drags us into half-building an exchange. No.
- **Researcher** = served by making every score auditable (methodology page) — a byproduct that also
  makes the scores citeable, which is distribution.

## The bets (ranked)

1. **The verdict header, everywhere.** One reusable pattern: asset = quality-tier badge AT THE TOP
   (never "Rating", never mobile-hidden) + Conviction beside realized price + a plain wash/insular
   verdict; address = reputation band as a green/amber/red "safe to deal with?" read that LOUDLY
   surfaces the computed bad-actor penalties (today only positive chips show); collection =
   strength + median tier + art. Pure re-composition of data already on the wire. Zero new pipeline.
2. **Rebuild the home front door around the collector's four questions** — what's good (Bluechip/
   grail wall), what's undervalued (Radar's Conviction≫price cut), who's real (top collectors +
   reputation), what happened (Firsts) — and lift Radar/Collections/Leaderboards/Firsts out of the
   dropdowns into persistent nav. The tape collapses to one secondary Activity strip.
3. **Render what we compute but never show:** Conviction on the asset page itself (today it exists
   ONLY on Radar); per-factor quality/reputation/Conviction breakdowns inline (auditable ≠ black
   box); the 7d momentum payload (volume_7d/trades_7d/price_change_7d) that read/assets.ts already
   fetches and renders nowhere.
4. **Own the vocabulary.** Bluechip/Premium/Notable/Speculative + Conviction + reputation bands as
   branded, citeable terms backed by a public reproducible methodology page (anchors, buyer gate,
   weights). Launch the 94k Emblem cross-chain census as the earned-media wedge — the one
   provably-unique claim no competitor can touch. Goal: xcpdex/Digirare/wallets quote OUR scores.
5. **Give the stateless tool memory** (ranked last on purpose — the only net-new capability):
   localStorage "recently viewed" + "since your last visit" now; a lightweight watchlist later,
   anchored on Radar as the daily habit. Every persona's "missing" list begged for this; anonymous-
   only is the retention ceiling.

## Page verdicts (lead-with)

- **Home:** one honest orienting line ("Counterparty is a 2014 Bitcoin protocol; its living culture
  is Rare Pepe, Stamps, and card NFTs — this site scores what's good and proves who's real") over a
  four-question launcher: grail wall · Radar undervalued · Collections (with art) · top collectors +
  Firsts. Tape demoted to a collapsed strip.
- **Asset:** verdict header (tier badge top, Conviction beside price, plain trust verdict, one
  plain-English "what is this" line: year · collection · Series X Card Y · N of M) + buy CTA with
  live venue price.
- **Address:** blunt trust verdict (band as green/amber/red) + surfaced bad-actor penalties + a
  one-phrase persona headline + evidence lines.
- **Collection:** art first (hero thumbnails, not a text table), one line of why it matters
  historically, strength bar with a plain gloss, median tier badge. Collector deep-dive = set-
  completion checklist ("cheapest to complete the set").

## Cuts / do-nots

- Mempool + latest-tx as home hero (node-operator concerns, not legibility) → one Activity strip.
- The Explore/Discover dropdowns as containers for the differentiators.
- The label "Rating" + mobile-hiding the tier — the single biggest self-inflicted wound.
- Building the trading terminal (OHLC of live books, depth, alerts, PnL, shop dashboards) — xcpdex's
  job; realized-value history from OUR data is fair game, live-book tooling is not.
- Blocks as a primary-nav peer of Assets (generic-explorer reflex) → fold into an Activity catalog.
- Serving six personas equally on the front door; a persona-picker quiz. Show the grail wall and
  the trust verdict to everyone; let surfaces self-route.
- Any score chip without its decomposition reachable.
- Any net-new subsystem before the already-computed value is rendered. **Surface first, build second.**

## The contrarian call (panel's provocation, undecided)

Stop being a neutral mirror; become an opinionated critic that publishes **named verdicts** — a
"recently flagged" wall of scam-seller/empty-shell/dumper addresses on the home page, and a branded
Bluechip canon that actively down-ranks junk. Every explorer is a neutral ledger; taking sides in
public is the only version of "trust layer" anyone remembers or quotes. Risk: occasional false
positives (a disclosed spent-vault sale looks identical on-chain to a scam) and the fight that
comes with naming names. Owner has NOT ruled on this.

## Comparable: bullscan.fun (reviewed 2026-07-10)

A brand-new Solana meme-coin scanner that is, structurally, our thesis shipped for a different
market: on-chain behavioral analysis → a judgment layer. Tagline: *"Every wallet is controlled by a
person. Their trades are their personality."* Not a competitor (meme-coin velocity vs our 12-year
canon), but a live data point on the direction we chose.

What they do that validates our bets:
- **The demo IS the pitch.** Their landing page leads with a live verdict — "$RUNE: 142 wallets ·
  5 flagged bad," each flagged wallet named with a classification badge and a count ("ARu4…n5mF —
  rugger — 86 bad coins"). No feature tour, no tape. That is bet 1 + bet 2 as a landing page.
- **Vivid, culture-native vocabulary as the product**: Bundler / Extractor / Nuker / Rugger / Crew /
  Side-wallets. Meme-trader slang, not academic terms. Bet 4, executed from day one — their
  classifications ARE the brand.
- **Receipts.** Every grade ships with proof links (exact coins, Solscan links) — "eliminating
  black-box opacity." Exactly our evidence-led reputation stance and the no-chip-without-breakdown
  cut.
- **They shipped our contrarian call.** Named, accusatory verdicts on specific wallets, on the
  front page, as the core product. Real-world evidence someone will do this; also a caveat — the
  Solana meme market is vast and anonymous, while Counterparty is a small community where naming
  names has social costs bullscan never pays.
- **One-question discipline.** The whole product answers "how many bad actors hold this coin
  before I buy?" — a sharpness our 37 routes lack; supports the single-ICP decision.

What to reject: burn-tokens-for-24h-access tokenomics (pay-to-see is misaligned with a knowledge
layer; we're free and citeable — that's our distribution), the too-neat vanity stats (123,123
tokens / 112,321 wallets — pattern-y numbers erode the trust the product sells; ours must stay
auditable), desktop-only gating. Their fear-first framing (bad actors) fits pre-trade meme
gambling; our frame stays taste-first (canon/quality) with the trust verdict at the seller-check
moment — same machinery, different lead.

## Raw material

Full structured outputs (6 persona surveys with per-surface at-a-glance/deep-dive/buried/missing
lists, 5 expert lenses with theses/moves/kills) live in the session workflow journal; the durable
distillation is this file. Regenerate by re-running the persona survey workflow if needed.
