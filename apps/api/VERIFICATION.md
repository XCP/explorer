# Mirror Verification Plan — api.xcp.io vs. Counterparty API

How we evaluate that the D1 mirror faithfully reproduces the live Counterparty node
(`api.counterparty.io:4000`). Run **after the backfill reaches tip parity** (blocks_behind ≤ 2).

## One-shot harness

```
curl -s -H "Authorization: Bearer $XCPIO_ADMIN_TOKEN" \
  "https://api.xcp.io/admin/verify" | jq
```

Implemented in `src/verify.ts`. Returns:

- **tip** — ours vs CP, `blocks_behind`, `caught_up`.
- **invariants** — `null_block_hash` (must be 0), `negative_balances` (must be 0).
- **counts** — per model: `ours`, `cp` (CP `result_count`), `diff` (ours−cp), `pct`.
- **supply** — XCP / PEPECASH / RAREPEPE: our `supply_normalized` vs CP's.

## Checks & thresholds

| #   | Check                     | Source                                           | Pass condition                                                                                                    |
| --- | ------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **Tip parity**            | both `/v2/blocks?limit=1`                        | `blocks_behind ≤ 2`                                                                                               |
| 2   | **Per-model counts**      | D1 `COUNT(*)` vs CP `result_count`               | `diff ≈ 0` per model (allow a few near tip; CP may count mempool/unconfirmed). Investigate any model off by >0.1% |
| 3   | **No NULL block hashes**  | D1                                               | `null_block_hash = 0`                                                                                             |
| 4   | **No negative balances**  | D1                                               | `negative_balances = 0`                                                                                           |
| 5   | **Supply parity**         | D1 `assets.supply_normalized` vs CP asset detail | exact string match for the 3 sample assets                                                                        |
| 6   | **Known totals** (sanity) | counts                                           | `fairmints ≈ 213,049`, `btcpays ≈ 2,964` (era-complete only after full catch-up)                                  |

## Manual deep checks (spot, not in the endpoint)

Run a handful by hand to catch shape/normalization drift the counts miss:

- **Balance conservation** (exact, BigInt): for an asset, Σ holder raw `quantity` (our `/v2/assets/{a}/balances`, paged) == CP supply raw. Use a couple of mid-size assets (not XCP — too many holders) so it's tractable.
- **Sample-address parity**: pick ~5 active addresses; diff our `/v2/addresses/{a}/balances` against CP `/v2/addresses/{a}/balances?verbose=true` — same asset set + same `quantity_normalized`.
- **Normalization**: for a divisible and an indivisible asset, confirm `quantity_normalized == raw/1e8` (divisible) and `== raw` (indivisible).
- **Invalid-as-marked**: confirm invalid messages are present with their `status` (e.g. the first XCP issuance shows `status: "invalid: ..."`), not dropped.
- **Reorg cursor**: confirm `last_block_hash` checkpoint matches CP's hash at our tip block.

## Storage budget

Inspect `xcpio-core` in Cloudflare. All Counterparty relations, including `ledger_events`, live in this
normalized database. `xcpio-btc` is independently budgeted recovery storage.

## Interpreting diffs

- **ours < cp by a small, steady amount** → just behind tip; re-run after catch-up.
- **ours < cp on ONE model only** → likely a missed/renamed event (cf. the NEW_FAIRMINT bug); check the event name + case handler in `sync.ts`.
- **ours > cp** → duplicate rows (concurrent-run/lock-TTL breach on an AUTOINCREMENT table); investigate the accelerator/lock.
