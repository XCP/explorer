# Bare-multisig recovery architecture

Bare-multisig recovery is a native API domain backed by `RECOVERY_DB` and R2. It does not depend on the retired
PHP application, source MySQL database, a proxy, or a separate Worker.

## Classification

Counterparty's historical encoding is `1 <source key> <data> 2 CHECKMULTISIG`; the recovery key is position
zero. Current encoding is `1 <data key> <data key> <source key> 3 CHECKMULTISIG`; the recovery key is position
two. Data chunks are deliberately adjusted until they are curve-valid public keys, so curve validity cannot
identify ownership by itself.

For every candidate output, the scanner:

1. parses the bare-multisig script exactly;
2. reconstructs and decrypts current Counterparty data using the first input transaction hash;
3. verifies the Counterparty prefix or historical plaintext data push;
4. selects the source-key position established by the proven layout;
5. derives the owning P2PKH address from the source key; and
6. stores structural classification separately from current spent state.

The scheduled scanner walks canonical transactions by `tx_index`. Its cursor is durable and each output is
upserted by `(txid, vout)`, making retries and overlapping boundary scans safe.

## Storage

- `RECOVERY_DB` stores one compact output row per `(txid, vout)`, address lookup indexes, protected transaction
  provenance, recovery attempts, aggregate snapshots, and scanner state.
- R2 stores one verified raw transaction per txid rather than duplicating transaction bodies per output.
- The extension's signer remains responsible for constructing the unusual spend. The API provides discovery,
  exact input evidence, and attempt tracking.

## Stamp protection

Stamp protection is transaction-level and independent of asset tags. The scanner evaluates the description of
each issuance belonging to the transaction; a later ordinary issuance does not become protected merely because
its asset carries a Stamp tag. Matches retain issuance-level provenance and are excluded from recovery results
by default.

## Runtime lifecycle

The main Worker incrementally discovers new outputs, verifies chain state through Electrs, reconciles submitted
attempts, and refreshes recovery statistics. Public reads are served directly from the recovery database. See
`recovery-operations.md` for health checks, migration rehearsal, and the optional R2 integrity audit.
