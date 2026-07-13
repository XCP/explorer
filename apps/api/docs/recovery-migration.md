# Bare-multisig recovery migration

## Production evidence (2026-07-12)

Read-only audit of the current `api.xcp.io` MySQL service:

| Measure | Count |
|---|---:|
| Indexed outputs | 1,696,169 |
| Unspent outputs | 1,456,497 |
| Rows marked recoverable | 809,973 |
| Unspent and marked recoverable | 595,278 |
| Historical 1-of-2 outputs | 223,623 |
| Current 1-of-3 outputs | 1,298,270 |
| Rows carrying previous-transaction hex | 806,619 |
| Unique transaction hashes carrying hex | 498,190 |
| Output/address relationships | 13,305,901 |
| Derived public-key/address rows | 8,371,974 |
| Recovery reports | 176 |

MySQL's table estimates put `utxos`, `pubkey_addresses`, and `utxo_pubkey_address` at roughly 18.9 GB
including indexes. This shape cannot move into the primary D1, which was already about 7.67 GB during the
audit. Most of the relationship expansion is unnecessary for the recovery read: Counterparty's encoding
identifies one recovery key, from which the one owning P2PKH address is derived deterministically.

The old flags are evidence, not canonical truth. For example, 1-of-3/`invalid-pubkeys` contains 710,920
unspent rows marked non-recoverable and 36,357 marked recoverable. A fresh classifier must decide from the raw
transaction, script, Counterparty encoding, ownership derivation, and chain state.

## Source-derived classification

Counterparty's historical encoding is `1 <source key> <data> 2 CHECKMULTISIG`; the recovery key is position
zero. Current encoding is `1 <data key> <data key> <source key> 3 CHECKMULTISIG`; the recovery key is position
two. Current data chunks are deliberately adjusted until they are curve-valid public keys, so curve validity
cannot distinguish data from ownership.

The classifier therefore:

1. parses the bare-multisig script exactly;
2. reconstructs and ARC4-decrypts current data using the first input transaction hash;
3. verifies the Counterparty prefix (or verifies the historical plaintext data push);
4. selects the source-key position dictated by the proven layout;
5. validates the source key and derives its P2PKH address;
6. keeps structural recovery classification separate from spent state.

## Target

- Separate D1 `xcpio-btc`: one compact row per `(txid, vout)`, one address lookup index, attempts and import
  state. It is isolated because the dataset is independently rebuildable and the primary D1 lacks headroom.
- R2 `xcpio-bitcoin-transactions`: one verified raw transaction per txid, rather than one duplicate blob per
  output.
- Upsert-only importer: raw hash, output value, and output script must all agree before a row is accepted.
- Existing extension signer remains in place. The migration changes discovery and evidence, not signing.

## Cutover gates

1. Bootstrap imports are replay-safe and resumable.
2. Classification discrepancies are counted and sampled by reason.
3. New and old address responses run in shadow parity.
4. Known historical and current fixtures build and verify signed transactions in the extension.
5. Spent-state freshness and RBF attempt tracking pass live checks.
6. The extension switches to the native routes.
7. Only then remove the proxy, old route surface, binding, and compatibility code.
