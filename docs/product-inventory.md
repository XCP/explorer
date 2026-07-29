# Product inventory & hypothesis ledger

A living "justify existence" ledger. Every surface, signal, and builder has to earn its place by making
the site more **legible** — a newcomer with little context should be able to glimpse *where to start, what
happened historically, who the players are, and what's good*, while power users, collectors, speculators,
creators, and merchants each find their lens.

This is not a static plan. It's a hypothesis ledger for **think → test → repeat**: each product bet is stated
as something the data can confirm or refute, with its current status. Refine in place; delete what fails.

Owner: this reflects the 2026-07 zoom-out. Update statuses as bets are tested.

---

## The spine — two base ratings, two derived axes, one composite lens

We built a lot of scoring machinery. It resolves into a small structure:

**Two base ratings (built):**
- **Asset quality** — `asset_signals` → composed score/tier (`reputation/score.ts`). "What's good?"
- **Address reputation** — trust/distrust, evidence-led (`reputation/`, graph trust). "Who's trustworthy?"
  Our best-designed surface: band + tags + evidence, never a black-box number.

**Two derived axes (latent in the data, not yet named as products):**
- **WHO — address persona.** Built: `reputation/persona.ts` classifies every ranked address by dominant
  behavior (creator/collector/merchant/trader, intensity-weighted with an honest secondary), served on the
  address reputation endpoint. Globally validated 2026-07-28 — see H2.
- **HOW NORMALLY it trades — market state.** Pieces exist (price, `realized_usd`, holder cohesion / wash,
  floor) but there is **no explicit "normal vs abnormal" baseline** per asset class or collection. Cohesion
  is one deviation detector; there is no general one.

**One composite lens:**
- **Collections / tags.** Not a standalone rating — the container where WHO and HOW-NORMALLY converge. A
  collection is interesting *because of the personas who hold/trade it and how normally it moves*. This is why
  it feels like "the biggest rating" and won't reduce to a single board metric: it's a synthesis of the other
  two axes at the collection level, read differently by each audience.

---

## The audiences (and what each reads through the lens)

Derived, not assumed — the population separates cleanly (probe 2026-07, `address_signals`, `last_block>0`):

| Persona | Count | Defining signal |
|---|---:|---|
| Total active | 452,455 | — |
| Creators / artists | 10,274 | `assets_issued ≥ 3` (+ stamps, src20 deploys) |
| Pure collectors | 13,894 | `assets_held ≥ 10`, never issued, not a shop |
| Traders / speculators | 5,466 | `dex_trades ≥ 10` |
| Merchants / dealers | 2,546 | `dispenses ≥ 10` (run shops) |
| Services (infra) | 28,310 | exchange / deposit / likely_service |
| Bad actors | 199 | vault/shell/dump scam flags |

**Takeaway:** "the players" = ~32k persona-classifiable addresses against a ~450k passive tail. The site should
lead with the elite, not the tail. Each persona reads a collection/asset differently:

- **Collector** — who else holds this, is the base established or churny, provenance, floor, is it canonical.
- **Speculator** — volume, price trend, liquidity, is it normal or a wash ring (cohesion).
- **Creator / artist** — is my work here, who collects it, secondary activity.
- **Merchant** — where it's dispensed, at what spread, remaining supply.
- **Newcomer** — the canon (top collections), the milestones (Firsts), the players (top reputation), the good
  assets (Featured).

---

## Surface inventory — justify-existence verdicts

KEEP = earns its place, freeze investment · ELEVATE = under-surfaced value, promote · MERGE/CUT = redundant or
science project · DEMOTE = real but belongs in admin/deep-cut, not front nav.

### The record floor (Explore menu — 16 routes)
Sends, Sweeps, Dispenses, Orders, Matches, Dispensers, BTCPays, Bets, Issuances, Fairminters, Fairmints,
Dividends, Destructions, Burns, Transactions, Broadcasts.
- **Verdict: KEEP, freeze investment.** Table-stakes credibility for "*the* explorer"; near-zero maintenance
  (uniform record tables). No newcomer starts here — never give them more design effort. The basement.

### The interpretive layer (Discover menu — where effort went; the scalpel zone)
| Surface | Verdict | Reasoning |
|---|---|---|
| **Reputation** (address) | ELEVATE → pillar | Best work; evidence-led. Promote out of a dropdown. |
| **Collections** | ELEVATE → composite lens | The convergence surface (WHO × HOW-NORMALLY). Stays a board *for now* (owner call) but is the highest-ceiling frontier. |
| **Firsts** | ELEVATE | Literally "what happened historically" — the newcomer timeline — buried in a submenu. |
| **Leaderboards** | MERGE / likely CUT | Shows creators/collectors/assets/reputation/stamps — each already a sort of an existing surface. Redundant aggregator. Open: what does it show the pillars-sorted don't? |
| **Radar** | JUSTIFY OR CUT | Emblem venue returns 0 orders (Sequence hasn't indexed). A half-empty "trending" page hurts legibility more than none. Earn a real momentum signal or delete. |
| **Vaults** | KEEP as deep cut | Unique data (Emblem-wrapped Counterparty on ETH), honest, but niche — not a newcomer surface. |
| **Graph** | CUT page, KEEP signal | Star graphs = tables; the one real value (cohesion) is already an asset chip. The page is now a science project. |
| **Collection Candidates** | DEMOTE to admin | Its own comment: "the owner reviews here, then promotes." Curation tool, not public nav. |
| **Exchanges / Network Stats / Mempool** | KEEP, low-investment | Reference + live vitals. |

### The machinery (builders / signals — justify-existence too)
- `signals.ts` / `asset_signals`, `holder-cohesion` — feed asset quality + wash detection. **KEEP.**
- graph stack (`graph-core`, `graph-eval`, `graph.ts`, `graph-extract`, `graph_edges`, `graph_trust`) —
  650k nodes / 1.7M edges powering address trust + cohesion. **KEEP if reputation stays a pillar** (it should),
  but heavy — audit that trust is actually legible/predictive, not just present.
- **Emblem stack** (`emblem-listings`, `emblem-meta`, `emblem-sales`, `emblem-scam`, `emblem-transfers`,
  `vault-contents`, `seaport`, `scarce-sales`) — **8 builders feeding one niche surface (Vaults), one of which
  (`listings`) produces nothing.** Most over-built-relative-to-surface part of the system. **AUDIT: retire the
  dead/redundant half.**
- `collections` / `tokenscan-collections` / `issuer-collections` / `curated`, `tags.ts` — collection
  attribution + classification substrate. **KEEP** (the composite lens depends on it).
- `prices` / `trades` / `scarce-sales` — the money layer. **KEEP.**

---

## The front-door problem

Home now leads with the collector's four questions: **Collections / Radar / Leaderboards / Firsts**, followed
by a grail wall and evidence previews. Latest sales remain as a compact secondary activity strip. The front-door
reorder is implemented without adding an index or a new API surface.

---

## Hypothesis ledger (think → test → repeat)

Each bet is falsifiable against our data. Status: `untested` / `testing` / `confirmed` / `refuted`.

- **H1 — Personas are real and separable.** Address behavior clusters into creator/collector/merchant/
  speculator, not mush. → *Status: confirmed* (probe above: clean, human-scale segments).
- **H2 — A global address persona is more useful than a bare reputation score.** Showing "Collector · high
  reputation" beats a lone number for the "who are the players" job. → *Status: confirmed (classifier
  validated globally 2026-07-28).* The shipped classifier (`reputation/persona.ts`) mirrored in SQL over all
  358k active addresses: creator 17,044 · collector 12,909 · trader 3,896 · merchant 3,118 (= 36,967
  "players", matching the ~32k thesis) against 171,715 light collectors + 77,922 dormant + 53,810 infra.
  Face-validity: top exemplars are self-announcing — `1FairPY…` (100,003 issuances) leads creators,
  `1BigDeaL…` (1,989 dispenses) leads merchants, top collectors hold 1,700–2,500 assets with little else,
  top traders run 1,400–4,000 DEX trades. One open wrinkle → the top creator tier is industrial-scale
  minting (mint mills behaving like services); persona reads honestly ("issues assets") but an owner call
  is pending on whether `likely_service` should overlay the headline for them. Remaining half of the bet —
  whether the persona headline beats a lone number *for users* — is now a product-surface question
  (elevate persona in boards/leaderboards), not a data question.
- **H3 — Collection legibility is a composite of persona-mix × market-normalcy, not a single score.** A
  collection page that reads its holder persona-mix and trade-normalcy serves all audiences better than one
  ranked list. → *Status: untested.* Test: prototype one collection page with a persona-mix band + a
  normal/abnormal market readout; compare to the current board row.
- **H4 — Market normalcy is definable.** Per-class baselines (price/volume/holder-churn) exist stably enough to
  flag deviations beyond cohesion. → *Status: untested.* Test: compute baselines for one collection tier, see
  if outliers are interpretable.
- **H5 — Cutting the science projects (Graph page, Candidates from nav) and half the Emblem stack loses no
  legibility.** → *Status: untested.* Test: pull them, watch nothing break.

---

## Open decisions (owner)
- Collections: stay a board metric for now (chosen 2026-07). Revisit if H3 confirms the composite lens.
- Naming for the composite lens if it graduates ("Standing" / "Canon" / "Collectability" — undecided).
- Radar and Leaderboards: fix-or-kill pending H5 and a Radar momentum-signal decision.
