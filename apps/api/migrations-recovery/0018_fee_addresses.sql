-- Recovery service fees moved from a static address list to an account-level BIP86 xpub, the same
-- layout the marketplace uses for its platform fee, so one wallet holds both revenue lines. The
-- Worker only ever sees the public key. The database owns index allocation (`id - 1` is the
-- derivation index) and keeps the exact address and path a later spend or reconciliation needs. A
-- crash between reserving a row and completing it leaves a recoverable null row, never an address
-- bound to two batches; the CHECK makes those the only two shapes a row can take.
CREATE TABLE recovery_fee_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL UNIQUE,
  key_id TEXT,
  derivation_index INTEGER CHECK(derivation_index IS NULL OR derivation_index >= 0),
  derivation_path TEXT,
  address TEXT UNIQUE,
  script_pubkey_hex TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(
    (key_id IS NULL AND derivation_index IS NULL AND derivation_path IS NULL
      AND address IS NULL AND script_pubkey_hex IS NULL)
    OR
    (key_id IS NOT NULL AND derivation_index IS NOT NULL AND derivation_path IS NOT NULL
      AND address IS NOT NULL AND script_pubkey_hex IS NOT NULL)
  ),
  UNIQUE(key_id, derivation_index)
);

-- A reported recovery now records which of its outputs is the fee, checked against the raw
-- transaction at report time rather than taken from the client's word. A fee paid to the legacy
-- static list has a vout but no allocation row.
ALTER TABLE recovery_attempts ADD COLUMN fee_address_id INTEGER REFERENCES recovery_fee_addresses(id);
ALTER TABLE recovery_attempts ADD COLUMN fee_vout INTEGER CHECK(fee_vout IS NULL OR fee_vout >= 0);
