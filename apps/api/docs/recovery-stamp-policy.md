# Recovery stamp policy

## Decision

Do not add `include_stamps` to the canonical recovery API. A Bitcoin Stamp output is not an
optional class of an address owner's recoverable output. The recovery index must prove that the
public key in Counterparty's owner-key position derives to the requested address. If it cannot,
the output is not recoverable for that address and must never be returned, regardless of a client
flag.

The extension's existing toggle should be removed when it moves to the canonical recovery API.
Until then, the old service remains responsible for its old behavior.

## What the old option actually does

The extension labels the option "Allow STAMPS to be spent" and sends `include_stamps` to the old
consolidation endpoint. The old controller defaults it to false and implements it solely by adding
`AND u.is_stamp = 0`; true removes that predicate. It does not perform a different signing method
or an ownership check.

The old `is_stamp` column has multiple, inconsistent writers:

- a Stampchain lookup marks every indexed output sharing a Stamp transaction hash;
- a batch import of Stampchain transaction hashes does the same;
- four hard-coded data-looking public keys mark an output as both a Stamp and unrecoverable; and
- other jobs infer the flag from the presence of data public keys.

Automatic Stamp checking is disabled by default in the old configuration. Consequently,
`is_stamp = 0` means "not marked by the old jobs," not authoritatively "not a Stamp." Importing
that boolean into the new classifier would preserve incomplete, heuristic state.

## Source-backed ownership rule

Current Counterparty multisig composition creates each data output as:

```
1 <encrypted data key> <encrypted data key> <source public key> 3 CHECKMULTISIG
```

This is explicit in Counterparty Core's `prepare_multisig_output`: the first two keys come from
`data_to_pubkey_pairs`, while the third is `get_source_pubkey(source, ...)`.

The official Bitcoin Stamps indexer parses its classic multisig form differently. It accepts the
same 1-of-3 shape only when the third key is in its configured burn-key set, and reconstructs the
payload from the first two keys. Its documentation describes Stamps as intentionally remaining in
the UTXO set. Therefore the third position in such an output is a burn key, not the creator's
source key.

The new recovery classifier already follows the Counterparty ownership rule:

1. verify the Counterparty payload/provenance;
2. select position 0 for historical 1-of-2 or position 2 for current 1-of-3;
3. derive the P2PKH address from that key; and
4. require an exact match to the expected address.

A Stamp burn-key output cannot pass that proof for a creator's address. Curve validity is not
ownership, and neither the first two data keys nor the burn key should be indexed as wallet-owned
recovery keys.

## Defensive protocol metadata

Stamp metadata may still be useful for auditing and explanations, but it must remain independent
of ownership classification. If added, use an authoritative transaction-level overlay keyed by
`txid`, sourced from the official Bitcoin Stamps index (including source, index version, validity,
and observation time). Do not infer it from repeated-byte keys, generic data-looking keys, numeric
asset names, descriptions alone, or the old `is_stamp` boolean.

Such metadata may make the classifier more conservative (for example, classify a source-confirmed
Stamp conflict as invalid and record a precise reason). It must never make an otherwise
non-recoverable output recoverable, and there should be no request parameter that bypasses the
ownership proof.

## Cutover acceptance checks

- No canonical recovery route accepts `include_stamps` or `includeStamps`.
- Every returned output has a source-backed Counterparty layout and an exact owner-key/address
  match.
- Known valid Stamp transaction outputs are absent from creator-address recovery results.
- Data-key and burn-key addresses are not treated as evidence of wallet ownership.
- The extension removes the toggle rather than silently mapping it to an ignored parameter.

## Local source trail

- `../extension/src/pages/actions/consolidate/form.tsx`
- `../extension/src/utils/blockchain/bitcoin/consolidationApi.ts`
- `../api.xcp.io/app/Http/Controllers/Api/ConsolidationController.php`
- `../api.xcp.io/app/Jobs/CheckIfUtxoIsStamp.php`
- `../api.xcp.io/app/Jobs/IndexStampsBatch.php`
- `../api.xcp.io/app/Jobs/ProcessBareMultisigUtxo.php`
- `../api.xcp.io/config/stamps.php`
- `../counterparty-core/counterparty-core/counterpartycore/lib/api/composer.py`
- `../btc_stamps/indexer/src/index_core/script.py`
- `../btc_stamps/indexer/src/index_core/transaction_utils.py`
- `../btc_stamps/README.md`

