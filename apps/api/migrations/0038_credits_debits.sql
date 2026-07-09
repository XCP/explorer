-- Phase 2 · the credit/debit ledger. balance.ts already receives every CREDIT/DEBIT event and nets it
-- into `balances`; until now the raw rows were discarded. Capturing them 1:1 gives a per-address
-- provenance view ("bought X from a dispenser at block N, received a dividend, was swept in") and a
-- definitive first-appearance signal — MIN(block_index) over credits — instead of unioning a dozen
-- typed event tables. Sizing (measured): ~4M credits + ~4M debits ≈ ~1.2 GB, DB ~5.2 → ~6.4 GB, well
-- under D1's 10 GB. event_index is globally unique per event, so it's the idempotent PK (replay-safe).
CREATE TABLE IF NOT EXISTS credits (
  event_index      INTEGER PRIMARY KEY,
  block_index      INTEGER NOT NULL,
  tx_hash          TEXT,
  address          TEXT NOT NULL,
  asset            TEXT NOT NULL,
  quantity         TEXT NOT NULL,
  calling_function TEXT,
  utxo_address     TEXT
);
CREATE INDEX IF NOT EXISTS idx_credits_address ON credits(address);
CREATE INDEX IF NOT EXISTS idx_credits_block ON credits(block_index);

CREATE TABLE IF NOT EXISTS debits (
  event_index      INTEGER PRIMARY KEY,
  block_index      INTEGER NOT NULL,
  tx_hash          TEXT,
  address          TEXT NOT NULL,
  asset            TEXT NOT NULL,
  quantity         TEXT NOT NULL,
  calling_function TEXT,
  utxo_address     TEXT
);
CREATE INDEX IF NOT EXISTS idx_debits_address ON debits(address);
CREATE INDEX IF NOT EXISTS idx_debits_block ON debits(block_index);
