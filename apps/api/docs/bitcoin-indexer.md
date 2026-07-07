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
  + follow-daemon    — small script: on each new block, getblock verbosity=2 (one RPC = every tx,
                       fully decoded), intersect vin/vout addresses with the follow set, derive
                       rows, push batches to the cloud. 6-confirmation lag for reorg safety.
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

- **Follow set**: every address in the Counterparty mirror (sources, destinations, issuers,
  holders) minus curated exchanges/burns/detected deposits — synced periodically from the main DB.
  New Counterparty users join the follow set as the mirror sees them (their BTC backfill enqueues).
- **Display histories** (the "include BTC txs in their history tab" feature) read from `btc_flows`
  when present, with the Counterparty node's /v2/bitcoin proxy as a live top-up for anything newer
  than the last push — the ONE place on-demand is right, because full history already exists
  locally and the proxy only fills the freshness gap.
- **Steady-state maintenance is LOCAL, not via public endpoints** (amended from the original
  sketch): per-block scanning needs full block bodies, which is one trivial RPC against our own
  node but ~120 paginated calls per block against anyone's public API. The Counterparty /v2/bitcoin
  endpoints serve as fallback/gap-heal if the local daemon is down, not as the primary.

## Phases

| Phase | What | Where | Effort |
|---|---|---|---|
| 0 | Agree this design; create `xcpio-btc` D1 + bindings + tables + ingest endpoints | cloud | small |
| 1 | Node + Fulcrum sync (unattended, days) | local | your hardware |
| 2 | Backfill: iterate follow set against Fulcrum → summaries + flows → push | local→cloud | script + a long weekend of runtime |
| 3 | Follow-daemon: per-block scan → incremental push; reorg lag; gap-heal via CP proxy | local→cloud | the core new code |
| 4 | Surfaces: BTC context on address pages, flows in history tabs | web | normal wave |
| 5 | Analyses, each through the existing gates: BTC features (harness), BTC graph edges (baseline A/B), funding-path wash traces (local job, verdict flags pushed), first-funder provenance | mixed | per research-backlog rules |

## What tonight's uncommitted scaffold becomes

The already-drafted `btc_signals` migration, ingest endpoint, address-universe export, and the
Esplora-mode exporter are all Phase 0/2 pieces and remain valid under this design — with two
amendments before committing: they target the separate `xcpio-btc` database (new binding), and the
exporter gains the Fulcrum mode as the primary bulk path (Esplora mode stays for testing/gap-fill).

## Open decisions

1. Separate `xcpio-btc` D1 database (recommended, for the 10GB headroom + independent lifecycle)
   vs. same DB. Recommendation: separate.
2. Follow set = all mirror-seen addresses (~500k+) vs. real-users filter (~262k). Recommendation:
   all mirror-seen minus infra — "ever touched Counterparty" is the honest definition of our world.
3. `btc_flows` retention: full flows forever vs. rolling window + aggregates. Start full, measure
   growth against the 10GB budget, decide with data.
4. Local daemon host: your machine vs. the Hetzner box (if disk allows). Either works; one-way push
   means no exposure difference.
