-- Idempotency so chunk re-application (on any transient failure) can't double-apply.
-- Each event-derived row carries its event_index — globally unique per CP event (verified against
-- counterparty-core: add_to_journal increments message_index per insert_record, incl. one per MPMA
-- dispersal). UNIQUE(event_index) + INSERT OR IGNORE => re-inserting a row is a no-op (no dup rows).
-- Balances get a per-(holder,asset) high-water event_index so a re-applied chunk's deltas are skipped
-- (root cause of the negative balances: double-applied CREDIT/DEBIT on retry).

ALTER TABLE sends ADD COLUMN event_index INTEGER;
ALTER TABLE issuances ADD COLUMN event_index INTEGER;
ALTER TABLE dispenses ADD COLUMN event_index INTEGER;
ALTER TABLE pool_matches ADD COLUMN event_index INTEGER;
ALTER TABLE fairmints ADD COLUMN event_index INTEGER;
ALTER TABLE destructions ADD COLUMN event_index INTEGER;
ALTER TABLE btcpays ADD COLUMN event_index INTEGER;
ALTER TABLE pool_liquidity ADD COLUMN event_index INTEGER;

-- UNIQUE indexes (SQLite treats NULLs as distinct, so legacy null rows never collide; the engine
-- always sets event_index on fresh inserts, so OR IGNORE dedupes re-applied chunks).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sends_evidx     ON sends(event_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_iss_evidx       ON issuances(event_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispe_evidx     ON dispenses(event_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pm_evidx        ON pool_matches(event_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fmint_evidx     ON fairmints(event_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_destr_evidx     ON destructions(event_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_btcpay_evidx    ON btcpays(event_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_poolliq_evidx   ON pool_liquidity(event_index);

ALTER TABLE balances ADD COLUMN updated_event_index INTEGER NOT NULL DEFAULT 0;
