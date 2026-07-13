# Extension API migration

## Goal

Move the browser extension from the temporary `app.xcp.io/api/v1` surface to intentional API contracts, then remove the proxy and compatibility response reshaping. Historical Counterparty bare-multisig formats remain supported; no versioned or compatibility API is retained.

This assessment is based on the extension source in the sibling `extension` repository and the current API implementation. It does not propose changing the extension's custom signer.

## Calls that must move

| Extension caller | Current request | Data actually consumed | Canonical destination | Status |
| --- | --- | --- | --- | --- |
| `useSearchQuery`, asset index | `GET /api/v1/simple-search?query=` | `assets[].symbol`, optional `supply` | `GET /v2/assets?query=&limit=20` | Available; adapt `{ result }`, map `asset -> symbol`, `supply_normalized -> supply` |
| `AssetSelectInput` | `GET /api/v1/search?type=assets&query=` | `assets[].asset`, `symbol`, `description`, `supply` | `GET /v2/assets?query=&limit=20` | Available; adapt `{ result }`; canonical rows already carry asset, description and exact normalized supply |
| XCP price fetcher | `GET /api/v1/asset/XCP` | `data.last_trade_price_usd`, optional market cap and 24h volume | A purpose-built price read | **Gap**; asset detail has `sales.last_price_usd`, but that is the latest collectible sale and is not a current XCP/USD quote |
| `useTradingPair` | `GET /api/v1/swap/:give/:get` | `data.trading_pair.last_trade_price`, `name` | A canonical arbitrary-pair market read | **Gap**; `/v2/assets/:asset/market` is fixed to `asset/XCP`, so it cannot preserve arbitrary pair orientation |
| recovery form and signer | `GET /api/v1/address/:address/consolidation` | discovery outputs, exact scripts and previous transactions, fee policy, page/batch summary, pending state | `GET /addresses/:address/recovery?page=&limit=` | Available after recovery cutover; extension adapter required |
| optional standalone signer | `GET /api/v1/address/:address/utxos` | bare-multisig recovery outputs only | `GET /addresses/:address/recovery` | Available for this usage; do not create a misleading general UTXO endpoint merely to copy the old name |
| recovery reporting | `POST /api/v1/address/:address/consolidation/report` | records a broadcast transaction and input/fee totals | `POST /addresses/:address/recoveries` | Available, with a stronger contract; extension must submit signed raw hex and exact fee/output values |
| recovery history | `GET /api/v1/address/:address/consolidation/status` | recent transaction state, confirmations, input count and recovered amount | `GET /addresses/:address/recoveries` plus recovery discovery summary | Partially available; lifecycle/confirmation maintenance and a few display fields are gaps |

Image URLs such as `app.xcp.io/img/icon/:asset` are separate from the JSON compatibility surface and need an explicit media-host decision during extension work.

## Recovery field mapping

The native discovery response is deliberately output-centric and uses satoshis throughout. The extension should define a small API DTO and adapt it once at its network boundary.

| Extension `ConsolidationData` field | Native field or derivation |
| --- | --- |
| `address` | `address` |
| `pubkey_compressed`, `pubkey_uncompressed` | Derive from the wallet key already obtained for signing; they do not need to cross the API boundary |
| `summary.total_utxos` | `summary.total_outputs` |
| `summary.total_btc` | `summary.total_value_sats / 100_000_000` for display only; transaction math stays in integer sats |
| `summary.batches_required` | `summary.pages` when `limit=420` |
| `summary.current_batch` | `summary.current_page` |
| `summary.batch_utxos` | `summary.outputs_on_page` |
| `fee_config.fee_address` | `fee.address` |
| `fee_config.fee_percent` | `fee.percent` |
| `fee_config.exemption_threshold` | `fee.exemption_sats` |
| `mempool_status.pending_consolidations` | `pending_attempts` |
| `mempool_status.can_broadcast_more` | derive `pending_attempts === 0`; this preserves the extension's current sequential-batch guard |
| `utxos[].txid`, `vout` | `outputs[].txid`, `vout` |
| `utxos[].amount` | `outputs[].value_sats` |
| `utxos[].script` | `outputs[].script_pubkey_hex` |
| `utxos[].position` | `outputs[].recovery_key_position` |
| `utxos[].script_type` | `outputs[].layout` |
| `utxos[].prev_tx_hex` | `transactions[txid]`; treat an entry in `missing_transactions` as a hard, non-signable error |
| `utxos[].sign_type` | Stop treating the old heuristic label as authority. The existing signer already analyzes the exact script; the API's deterministic classification decides whether the output is offered at all |
| `validation_summary` | No longer required for permission. If retained as UI information, derive it from explicit layout/script analysis rather than old source labels |

Direct page navigation is preserved: page size is bounded at 420 and `summary.pages` permits fetching any page, including the last. The extension currently fetches every batch concurrently. It should instead fetch page one for the overview and retrieve subsequent pages just before sequential signing; this avoids holding hundreds of raw transactions in memory and avoids signing stale pages.

`include_stamps` has no native equivalent. The old UI defaults it to false, but the recovery index currently has no authoritative stamp/output relationship on which to enforce that filter. Before extension cutover, decide one of the following explicitly:

1. Remove the option and recover every deterministically recoverable bare-multisig output.
2. Add a source-backed output classification with tests proving what constitutes a Stamp output.

Do not reproduce the old behavior heuristically.

## Recovery submission and history

After broadcasting a signed batch, the extension has all fields required by the native endpoint:

```json
{
  "raw_transaction_hex": "<signed transaction>",
  "network_fee_sats": 1234,
  "service_fee_sats": 5678,
  "output_value_sats": 9012
}
```

The API parses the transaction, derives its txid, verifies every input belongs to that address and remains recoverable, rejects duplicate or concurrently pending inputs, and verifies the reported arithmetic. This is intentionally stronger than accepting the old report's caller-supplied txid and aggregate counts.

Before the extension can switch its history UI, the API still needs:

- attempt reconciliation against Electrs so `pending` becomes `confirmed`, `replaced`, or a clearly named terminal state;
- confirmation count or enough block/tip information to derive it;
- a stable replacement relationship when an RBF transaction replaces an attempt;
- recovered input count (already returned as `input_count`) and amount (`output_value_sats`, with an explicit decision whether the UI means destination value or total input value);
- a combined status adapter in the extension: available output count/value comes from discovery, while attempt history comes from `/recoveries`.

The read gate must remain closed until bootstrap and chain reconciliation finish. A `503` from discovery is an indexing state, not “no recoverable outputs.”

## Asset and market adapters

For search, the extension should consume canonical rows rather than asking the API to emit duplicate aliases:

```ts
type AssetSearchResponse = {
  result: Array<{
    asset: string;
    asset_longname: string | null;
    description: string | null;
    supply_normalized: string | null;
  }>;
};

const options = response.result.map((asset) => ({
  asset: asset.asset,
  symbol: asset.asset,
  description: asset.description ?? "",
  supply: asset.supply_normalized ?? "0",
}));
```

Keep normalized quantities as strings. Converting supply to `number` in a compatibility layer loses precision for large indivisible supplies.

Two market contracts should be designed before deleting the compatibility router:

- an arbitrary ordered pair read that returns base, quote, pair name and last price with documented orientation;
- a current XCP/USD quote read with source and timestamp. Do not substitute `AssetDetail.sales.last_price_usd`, which has different semantics.

The existing XCP price fetcher already has independent fallbacks, so the price gap does not block recovery migration. The arbitrary-pair read does block removal of the swap proxy for current extension behavior.

## Execution order

1. Finish recovery import, Electrs reconciliation, parity audit and read-gate activation.
2. Add and test attempt lifecycle reconciliation. Validate pending, confirmation and replacement behavior with known transactions.
3. Decide the `include_stamps` product behavior using authoritative source data; remove the option if no sound classification exists.
4. Add canonical arbitrary-pair and XCP/USD quote contracts. Keep their response types in shared contracts and test price orientation.
5. In the extension, introduce one configured explorer API base and typed clients for asset search, market data and recovery. Remove hard-coded `app.xcp.io`/`api.xcp.io` URLs from feature modules.
6. Adapt recovery pages lazily, preserve integer satoshi values, and submit signed raw transactions to the native attempt endpoint after broadcast.
7. Run extension unit tests plus a recovery fixture covering historical 1-of-2, current 1-of-3, last-page access, invalid data keys and a spent output.
8. Release the extension against the canonical surface and observe it through a soak period.
9. Search the extension source and built artifacts for `/api/v1`, `app.xcp.io/api`, and the old consolidation response names. Only when none remain, delete `legacy.ts`, its router mount, `CONSOLIDATION_API`, and the old service dependency.

## Removal gate

The compatibility surface is removable only when all of these are true:

- recovery reads are open and parity-verified;
- attempt state is maintained from the chain rather than caller reports;
- arbitrary-pair and XCP/USD needs have canonical homes or are intentionally removed from the extension;
- the released extension no longer calls any compatibility URL;
- old installed extension versions have a deliberate support policy—the server must not silently keep permanent compatibility code by accident.

