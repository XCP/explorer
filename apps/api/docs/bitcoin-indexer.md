# Bitcoin follow-set indexer — design (PLAN, not yet built)

*2026-07-07. The Counterparty mirror is blind to plain Bitcoin activity. This design adds the wide
Bitcoin network around our users: their non-Counterparty transactions, their BTC balances, and the
one-hop-out addresses that fund them — as a FOURTH sidecar indexer, following the same architecture
rules as Emblem (derived, never contaminates the Counterparty mirror, rebuildable).*

## The idea (owner's framing)

Follow every address that has ever touched Counterparty. Bootstrap their full Bitcoin histories
from a local node; then maintain per-block: for each new Bitcoin block, scan its transactions and
keep the ones touching followed addresses. Addresses one hop out (a pure-Bitcoin wallet that funded
a Counterparty user) get *represented* — recorded as endpoints — without being followed themselves.

## Why this is worth building (the analysis payoff)

The Counterparty mirror sees the trade; the BTC side sees the MONEY BEHIND the trade. Behaviors
that are invisible today and become detectable with `btc_flows`:

- **Straw buyers**: "distinct" buyers of an asset who were all funded from one wallet right before
  buying. The current `__realized_usd` buyer gate counts distinct addresses; BTC funding edges
  reveal when distinct addresses are one actor. (Research-backlog #3, circular-funding wash check,
  becomes fully implementable — today it can only see funding that happened *through* Counterparty.)
- **Self-funded dispenser purchases**: an operator BTC-funding a fresh address that then buys from
  their own dispenser. The origin-aware attribution catches same-address cases; BTC flows catch the
  one-hop-laundered version.
- **Wash-trade loops with a plain-BTC leg**: A sells to B on-chain, B's payment came from A via a
  pure Bitcoin hop the mirror never sees. Closing this blind spot is the single biggest hardening
  of the trades ledger.
- **Fund-shuffling / self-clustering**: an address that mostly moves BTC among a small closed set
  of addresses (vs. transacting with the wide world) is one actor with many keys. Feeds clustering
  and dedupes the graph's vouch edges (self-vouching via sock puppets).
- **Common-input-ownership clustering**: the classic heuristic — addresses co-spent as inputs in
  one tx share an owner. Flow rows carry exactly the (txid, addr) pairs needed to derive cluster
  IDs, which would collapse sybil families across ALL scoring, not just the graph.
- **Economic-substance check on trust edges**: research-backlog #7 (value-weighted edges) gets its
  denominator — a vouch backed by real BTC movement vs. a dust send.

All of these are Phase-5 analyses gated by the coverage-fairness rule (complete backfill first),
and none require storing transaction bodies — the flow tuples carry everything above.

## Hard constraints that shape the design

1. **D1 size ceiling**: the main database is ~5.6GB of the 10GB hard cap. Raw BTC transaction
   storage for ~262k active wallets is tens of GB — it can never live in D1. Therefore: **raw
   capture stays local; the cloud stores only bounded derivatives.** (Separately: 56% capacity on
   the main DB is a standing watch item for the Counterparty mirror itself.)
2. **Public-service etiquette**: no bulk sweeps against public Esplora or the Counterparty node's
   /v2/bitcoin proxy (their Electrs backends are documented to buckle). Bulk work belongs on our
   own node.
3. **Follow-set explosions**: exchanges, deposit addresses, and burns must be EXCLUDED from the
   follow set (Bittrex's hot wallet has millions of BTC txs that tell us nothing). Same
   machines-don't-vouch list the graph uses. Per-address tx caps with an overflow flag for
   anything that still runs hot.
4. **Coverage fairness**: BTC-derived features may enter SCORING only after the follow-set
   universe is completely backfilled (a partially-fetched universe biases any feature computed on
   it — coverage would masquerade as signal). Until then, BTC data is display/analysis only, and
   NULL means "not fetched", never zero.

## Architecture: local capture, cloud derivatives

```
LOCAL (your machine, one-time ~1TB disk)
  bitcoind (full node)
  + Fulcrum          — address index, needed for the BACKFILL phase (histories per address)
  + follow-daemon    — small script: on each new block, getblock verbosity=3 (Core ≥25; one RPC =
                       every tx fully decoded INCLUDING prevout addresses for inputs — no extra
                       lookups to resolve senders), intersect vin/vout addresses with the follow
                       set, derive rows, push batches to the cloud. 6-confirmation lag for reorg
                       safety; idempotent upserts keyed (txid, addr, direction) so replays are safe.
        │  one-way HTTPS push (Bearer), batched
        ▼
CLOUD (new, SEPARATE D1 database `xcpio-btc`, own binding — protects the main DB's headroom)
  btc_signals   — per-followed-address summary: received/sent/balance/txs/first/last/updated/source
  btc_flows     — bounded flow rows: (txid, block, addr, counterparty_addr, direction, sats) for
                  followed↔followed and followed↔one-hop flows; one-hop addresses appear as strings
                  here (the "wide network represented") without joining the follow set.
                  NO TRANSACTION DATA IS STORED — no hex, no vin/vout bodies, no tx table. txid is
                  a reference only (deep inspection follows it back to the node / the CP proxy).
                  Rough budget: a flow row is ~100 bytes; even 10M flows ≈ 1GB — and the follow
                  daemon derives flows deterministically, so the table is rebuildable from the
                  chain at any time, meaning retention can be cut later without losing anything.
  btc_watch     — the follow set itself + per-address cursor/overflow flags (synced FROM the main
                  DB's address universe minus the infra exclusions)
```

- **Two-tier address model** (the scope rule that keeps this bounded):
  - **Tier 1 — FOLLOWED** (full flow indexing): addresses that have used or received Counterparty —
    every address in the mirror (sources, destinations, issuers, holders) minus curated
    exchanges/burns/detected deposits. Their complete Bitcoin history is captured as flows.
  - **Tier 2 — KNOWN** (represented, not indexed): pure-Bitcoin addresses that ever transacted
    with a Tier-1 address. They exist only as counterparty endpoints on Tier-1 flow rows — we are
    *aware* of them (they can be displayed, counted, graphed as endpoints) but we never index
    their own transaction histories. This is the wall that prevents transitive crawl of the
    whole chain.
  - **Promotion**: the moment a Tier-2 address touches Counterparty, the mirror sees it, it joins
    Tier 1, and its full BTC backfill enqueues (Fulcrum makes late backfill cheap).
  New Counterparty users join the follow set as the mirror sees them.
- **Display histories** (the "include BTC txs in their history tab" feature) read from `btc_flows`
  when present, with the Counterparty node's /v2/bitcoin proxy as a live top-up for anything newer
  than the last push — the ONE place on-demand is right, because full history already exists
  locally and the proxy only fills the freshness gap.
- **Steady-state maintenance is LOCAL, not via public endpoints** (amended from the original
  sketch): per-block scanning needs full block bodies, which is one trivial RPC against our own
  node but ~120 paginated calls per block against anyone's public API. The Counterparty /v2/bitcoin
  endpoints serve as fallback/gap-heal if the local daemon is down, not as the primary.

## Sizing (measured, 2026-07-07 — 100-address random sample vs Esplora)

Hypothesis tested: "non-Counterparty txs ≈ 10% of an address's Counterparty txs." Result: right
shape for the median, wrong for the tail — the distribution is violently heavy-tailed:

- Per-address nonCP/CP ratio: p25 0.83 · **median 1.0** · p75 3.0 · p90 170 · max 3,716.
- Aggregate ratio 8.4× — dominated by generic wallets with 1-3 CP txs and 850-3,700 BTC txs.
- 53/100 followed addresses originated ZERO CP txs (receive-only holders): the follow set is
  majority-passive.

**Rule derived: the per-address flow cap is load-bearing.** Full flows only up to ~1,000 BTC txs
per address; beyond that → summary-only + `overflow` flag (one CP touch among thousands of BTC txs
is a generic wallet, not a Counterparty participant — its full history is noise for our purposes).
With the cap, expected flow volume ≈ 2-3× the CP mirror's 3.4M txs ≈ 7-10M rows ≈ ~1GB. In budget.

## Phases

| Phase | What | Where | Effort |
|---|---|---|---|
| 0 | Agree this design; create `xcpio-btc` D1 + bindings + tables + ingest endpoints | cloud | small |
| 1 | Node + Fulcrum sync (unattended, days) | local | your hardware |
| 2 | Backfill: iterate follow set against Fulcrum → summaries + flows → push | local→cloud | script + a long weekend of runtime |
| 3 | Follow-daemon: per-block scan → incremental push; reorg lag; gap-heal via CP proxy | local→cloud | the core new code |
| 4 | Surfaces: BTC context on address pages, flows in history tabs | web | normal wave |
| 5 | Analyses, each through the existing gates: BTC features (harness), BTC graph edges (baseline A/B), funding-path wash traces (local job, verdict flags pushed), first-funder provenance | mixed | per research-backlog rules |

## Related systems: the consolidation service (investigated 2026-07-07)

The bare-multisig consolidation feature used by the wallet extension is served TODAY by the old
`XCP/app.xcp.io` Laravel app (live at app.xcp.io, MySQL, bootstrapped from Sandshrew Esplora —
verified: `GET /api/v1/address/{addr}/consolidation` answers). Its architecture is this plan's
follow-daemon in PHP form: `MonitorBlockchainJob` watches each new Bitcoin block, marks spent
UTXOs, discovers new addresses (`UTXO_INDEXING_ARCHITECTURE.md` in that repo).

Migration path (when the follow-daemon exists, not before):
1. ETL the unspent bare-multisig UTXO rows (utxo, script_pubkey_hex, prev_tx_hex, claimability,
   sign_type) from MySQL into `xcpio-btc` — same one-way-push ingest the flows use.
2. Port the two consolidation endpoints (`/consolidation`, `/claimable`) into the Worker — thin
   reads, fee_config included.
3. The follow-daemon's per-block scan takes over spent-status maintenance — it is ALREADY looking
   at every tx touching followed addresses; flagging spent multisig UTXOs is one extra
   intersection, not a second system.
4. Extension repoints to xcp-api; Laravel app retires (its Zaif/CMC trade history gets its own
   one-time export first — see research-backlog.md "Data acquisition").
Until then: leave the Laravel app running — it works and costs nothing new. Do NOT build a second
block-watcher just for consolidation; that's the same double-driver mistake D1 already taught us.

## What tonight's uncommitted scaffold becomes

The already-drafted `btc_signals` migration, ingest endpoint, address-universe export, and the
Esplora-mode exporter are all Phase 0/2 pieces and remain valid under this design — with two
amendments before committing: they target the separate `xcpio-btc` database (new binding), and the
exporter gains the Fulcrum mode as the primary bulk path (Esplora mode stays for testing/gap-fill).

## Decisions (proposed 2026-07-07 — accept/veto individually)

1. **Database: separate `xcpio-btc` — DECIDED separate.** Three independent reasons, any one
   sufficient: (a) headroom — the main DB is 5.6/10GB and flows grow with the chain forever;
   (b) contention isolation — measured today: the graph build's write passes degraded production
   reads from ~100ms to 19-30s; a per-block ingest writing every ~10 minutes must never queue
   behind mirror reads, or vice versa; (c) lifecycle — flows are rebuildable from the chain, so
   the whole DB can be dropped and rebuilt without risking the mirror. No cross-DB joins are
   needed: reads are per-address point lookups the Worker stitches with `Promise.all` across
   bindings, and the follow-set metadata (`btc_watch`) lives in `xcpio-btc` anyway. D1 bills by
   usage, not by database — a second DB costs nothing extra.

2. **Follow set: all mirror-seen minus infra (~500k) — DECIDED broad.** The sizing sample settles
   this: 53% of followed addresses are receive-only holders. The narrow "real users" filter
   (~262k) would delete most of the world — and precisely the holders that the vaulted/holder
   features care about. Breadth is affordable because the cap rule (below) bounds the tail, which
   is where the cost lives regardless of breadth. And "in the mirror = followed" is one crisp rule
   with zero classifier drift; Tier-2 promotion stays trivial.

3. **Retention: full flows forever, bounded by the measured per-address cap — DECIDED
   start-full.** A rolling time window would violate the coverage-fairness rule (windowed data
   biases every derived feature against old activity — and this ecosystem's value IS 2015-2017
   provenance). The per-address cap (~1,000 BTC txs, summary-only + `overflow` beyond) is the
   right bound because the sample shows volume lives in generic-wallet tails, not in history
   depth. Flows are deterministic derivatives, so this is reversible either direction. Watch
   trigger: revisit if `xcpio-btc` passes 6GB.

4. **Host: split by phase — the two phases have different requirements. DECIDED: backfill local,
   steady-state on the always-on box.**
   - *Backfill (one-time)* needs an address index → Fulcrum → an unpruned node (~800GB incl.
     Fulcrum's ~130GB). That's the local machine's job — the ~1TB disk is needed exactly once.
   - *Steady-state* needs only the chain tip: `getblock verbosity=3` works fine on a **pruned**
     node (`prune=50000` ≈ 60-70GB total footprint) — no Fulcrum, no archive. That fits the
     Hetzner box cheaply and runs 24/7; a desktop that sleeps/reboots would lean on gap-heal as
     the routine path instead of the exception, which is backwards.
   - *Hosted-RPC alternative — Sandshrew, VERIFIED WORKING 2026-07-07.* Live endpoint is
     `https://mainnet.subfrost.io/v2/<key>` (JSON-RPC; the docs' sandshrew.io/v1 examples are
     stale — v1 is decommissioned). Key in `apps/api/sandshrew.tok` (gitignored). Free tier:
     100k requests/day. Verified against the plan's needs: `esplora_address` (chain_stats
     summaries), `esplora_address::txs` (full paginated history incl. vin prevouts),
     `btc_getblock` verbosity=3 (tested: block 956900, 4,546 txs, 13.6MB, prevout sender
     addresses present). This REPLACES the pruned Hetzner node for Phase 3 maintenance (~144
     block calls/day — trivial quota) and covers the Phase 2 SUMMARY backfill (1 req/address ≈
     5-6 days of quota for 500k). Full-FLOWS backfill via paginated history is feasible but slow
     (~1-2 weeks of continuous quota grinding) — the local Fulcrum weekend remains the preferred
     bulk path, with Sandshrew as the no-hardware fallback. Net: the local node is now an
     accelerator, not a dependency.
